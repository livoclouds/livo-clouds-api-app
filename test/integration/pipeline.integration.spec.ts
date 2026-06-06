/**
 * Pipeline integration test — import → classification → reconciliation → summary.
 *
 * Drives ClassificationService.classifyBatch against a REAL Postgres and asserts
 * the engine's structural contract plus the downstream FinancialMonthlySummary and
 * DashboardService.getKpis aggregations. This is the crown-jewel financial flow, so
 * it is exercised end-to-end (real DB), not with a mocked Prisma.
 *
 * Why classifyBatch directly (not ImportsService.confirm): confirm() defers
 * classification via `setImmediate` (fire-and-forget), which is racy to await. The
 * file parsing / R2 upload it wraps is a separate concern; the pipeline VALUE lives
 * in classify → reconcile → summarise, which is what this seeds and verifies.
 *
 * Three deterministic rows:
 *   A — EXPENSE "PAGO CFE LUZ"  → EXPENSE rule (keyword "CFE")    → AUTO + category
 *   B — INCOME  "DEPOSITO …"    → no rule, no padrón match        → NEEDS_REVIEW (unmatched)
 *   C — INCOME  "CUOTA101"      → UNIT rule → unit 101 → resident → AUTO + residentId
 */
import { FlowType, ReconciliationRuleKind } from '@prisma/client';

import {
  closePipelineContext,
  createPipelineContext,
  describeIntegration,
  PipelineContext,
  resetDb,
} from './db';

// Mid-month date keeps the year/month bucket stable across CI (UTC) and local
// timezones — day 15 never crosses a month boundary under any offset.
const YEAR = 2026;
const MONTH = 3; // March
const TX_DATE = new Date('2026-03-15');

interface SeededFixture {
  condominiumId: string;
  batchId: string;
  expenseCategoryId: string;
  residentId: string;
  expenseRuleId: string;
}

/**
 * Seeds the minimal valid graph for one classification run and returns the ids the
 * assertions need. Required fields mirror prisma/schema.prisma exactly; everything
 * else relies on schema defaults.
 */
async function seedPipelineFixture(
  ctx: PipelineContext,
): Promise<SeededFixture> {
  const { prisma } = ctx;

  const condo = await prisma.condominium.create({
    data: { slug: `it-${Date.now()}`, name: 'Integration Test Condo' },
  });

  await prisma.condominiumSettings.create({
    data: { condominiumId: condo.id, currency: 'MXN', totalUnits: 10 },
  });

  const importer = await prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `importer-${condo.id}@example.test`,
      passwordHash: 'x', // never authenticated in this test
      firstName: 'Imp',
      lastName: 'Orter',
    },
  });

  const category = await prisma.expenseCategory.create({
    data: { condominiumId: condo.id, name: 'Electricidad', systemKey: 'UTILITIES' },
  });

  const bankProfile = await prisma.bankProfile.create({
    // bankName=null → engine uses the generic text extractor (not the BanBajío path),
    // keeping classification deterministic for this fixture.
    data: { condominiumId: condo.id, name: 'Generic', excelAliases: {} },
  });

  const resident = await prisma.resident.create({
    data: {
      condominiumId: condo.id,
      unitNumber: '101',
      unitNumberNormalized: '101',
      firstName: 'Ana',
      lastName: 'García',
    },
  });

  // EXPENSE rule: fires on outflows whose description contains "CFE".
  // confidenceThreshold 0.80 ≥ 0.8 ⇒ AUTO.
  const expenseRule = await prisma.reconciliationRule.create({
    data: {
      condominiumId: condo.id,
      name: 'CFE → Electricidad',
      ruleKind: ReconciliationRuleKind.EXPENSE,
      keywords: ['CFE'],
      unitPatterns: [],
      expenseCategoryId: category.id,
      confidenceThreshold: 0.8,
      priority: 1,
    },
  });

  // UNIT rule: fires on inflows containing "CUOTA101", assigns unit 101. A high
  // threshold (0.95) guarantees the resident link auto-classifies.
  await prisma.reconciliationRule.create({
    data: {
      condominiumId: condo.id,
      name: 'CUOTA101 → Unidad 101',
      ruleKind: ReconciliationRuleKind.UNIT,
      keywords: ['CUOTA101'],
      unitPatterns: [],
      assignedUnitNumber: '101',
      confidenceThreshold: 0.95,
      priority: 2,
    },
  });

  const batch = await prisma.importBatch.create({
    data: {
      condominiumId: condo.id,
      importedById: importer.id,
      bankProfileId: bankProfile.id,
      fileName: 'estado-marzo.xlsx',
      fileType: 'xlsx',
      fileSizeBytes: 1024,
      fileHash: `hash-${condo.id}`,
    },
  });

  // All rows land NEEDS_REVIEW by default (schema default) so classifyBatch processes them.
  await prisma.transaction.createMany({
    data: [
      {
        condominiumId: condo.id,
        importBatchId: batch.id,
        transactionDate: TX_DATE,
        description: 'PAGO CFE LUZ',
        charges: 800,
        balance: 0,
        flowType: FlowType.EXPENSE,
      },
      {
        condominiumId: condo.id,
        importBatchId: batch.id,
        transactionDate: TX_DATE,
        description: 'DEPOSITO NO IDENTIFICADO',
        credits: 1500,
        balance: 1500,
        flowType: FlowType.INCOME,
      },
      {
        condominiumId: condo.id,
        importBatchId: batch.id,
        transactionDate: TX_DATE,
        description: 'CUOTA101',
        credits: 2000,
        balance: 3500,
        flowType: FlowType.INCOME,
      },
    ],
  });

  return {
    condominiumId: condo.id,
    batchId: batch.id,
    expenseCategoryId: category.id,
    residentId: resident.id,
    expenseRuleId: expenseRule.id,
  };
}

describeIntegration('classification pipeline (integration)', () => {
  let ctx: PipelineContext;
  let fx: SeededFixture;

  beforeAll(async () => {
    ctx = await createPipelineContext();
  });

  afterAll(async () => {
    if (ctx) await closePipelineContext(ctx);
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    fx = await seedPipelineFixture(ctx);
  });

  it('classifies a batch: rule-matched rows AUTO, unmatched rows NEEDS_REVIEW', async () => {
    const summary = await ctx.classification.classifyBatch(
      fx.condominiumId,
      fx.batchId,
    );

    // 3 rows in → 2 auto-classified (expense rule + unit rule), 1 left for review,
    // of which 1 has no resident link (the unidentified deposit).
    expect(summary).toEqual({
      total: 3,
      classified: 2,
      needsReview: 1,
      unmatched: 1,
    });
    // Invariant: every row is either auto or needs-review.
    expect(summary.classified + summary.needsReview).toBe(summary.total);
  });

  it('stamps the EXPENSE row with the rule category and AUTO status', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const expense = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, flowType: FlowType.EXPENSE },
    });

    expect(expense.classificationStatus).toBe('AUTO');
    expect(expense.expenseCategoryId).toBe(fx.expenseCategoryId);
    expect(expense.matchedRuleId).toBe(fx.expenseRuleId);
    expect(expense.matchSource).toBe('RULE');
    expect(expense.residentId).toBeNull(); // expenses never link a resident
  });

  it('links the unit-rule INCOME row to the padrón resident (AUTO)', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const matched = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, description: 'CUOTA101' },
    });

    expect(matched.classificationStatus).toBe('AUTO');
    expect(matched.residentId).toBe(fx.residentId);
    expect(matched.unitNumberDetected).toBe('101');
  });

  it('leaves the unidentified INCOME row NEEDS_REVIEW with no resident', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const orphan = await ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId: fx.condominiumId, description: 'DEPOSITO NO IDENTIFICADO' },
    });

    expect(orphan.classificationStatus).toBe('NEEDS_REVIEW');
    expect(orphan.residentId).toBeNull();
  });

  it('writes a FinancialMonthlySummary with classification counts for the month', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const monthly = await ctx.prisma.financialMonthlySummary.findUniqueOrThrow({
      where: {
        condominiumId_year_month: {
          condominiumId: fx.condominiumId,
          year: YEAR,
          month: MONTH,
        },
      },
    });

    expect(monthly.transactionCount).toBe(3);
    expect(monthly.classifiedCount).toBe(2);
    expect(monthly.needsReviewCount).toBe(1);
    expect(monthly.unmatchedCount).toBe(1);
    // Official income/expense totals only count APPROVED rows; classifyBatch does
    // not approve, so these stay 0 until reconciliation. Asserted to lock that contract.
    expect(Number(monthly.totalIncome)).toBe(0);
    expect(Number(monthly.totalExpenses)).toBe(0);
  });

  it('reflects the month totals in the dashboard KPIs', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const { kpis } = await ctx.dashboard.getKpis(fx.condominiumId, YEAR, MONTH);

    // getKpis aggregates ALL rows in the month (no approval filter), so it surfaces
    // the raw imported amounts: income 1500 + 2000, expense 800.
    expect(kpis.totalIncome).toBe(3500);
    expect(kpis.totalExpenses).toBe(800);
    expect(kpis.netBalance).toBe(2700);
  });

  it('re-running classifyBatch on the same batch is idempotent (no double-counting)', async () => {
    // First run — establishes the baseline classification.
    const first = await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    // Second run — simulates a retry or re-trigger (network error recovery, manual
    // re-classify). The engine must produce the same summary and must not corrupt the
    // FinancialMonthlySummary counters or the dashboard totals.
    const second = await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    expect(second).toEqual(first);

    // The monthly summary must not double-count rows. transactionCount is a SET
    // operation (upsert), not an increment, so re-running must leave it unchanged.
    const monthly = await ctx.prisma.financialMonthlySummary.findUniqueOrThrow({
      where: {
        condominiumId_year_month: {
          condominiumId: fx.condominiumId,
          year: YEAR,
          month: MONTH,
        },
      },
    });

    expect(monthly.transactionCount).toBe(3);
    expect(monthly.classifiedCount).toBe(2);
    expect(monthly.needsReviewCount).toBe(1);

    // Dashboard KPIs must remain stable across reruns.
    const { kpis } = await ctx.dashboard.getKpis(fx.condominiumId, YEAR, MONTH);
    expect(kpis.totalIncome).toBe(3500);
    expect(kpis.totalExpenses).toBe(800);
    expect(kpis.netBalance).toBe(2700);
  });
});
