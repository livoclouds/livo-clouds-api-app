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

// A syntactically valid UUID that is never seeded — drives the not-found guards
// without tripping Prisma's uuid column validation.
const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

interface SeededFixture {
  condominiumId: string;
  batchId: string;
  expenseCategoryId: string;
  residentId: string;
  expenseRuleId: string;
  importerId: string;
}

/** A second tenant used to prove cross-condominium isolation. */
interface SecondaryCondo {
  condominiumId: string;
  userId: string;
  residentId: string;
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
    importerId: importer.id,
  };
}

/**
 * Seeds a second, otherwise-empty tenant: a condominium with settings, one user
 * (a valid actor for audit logs), and one resident. Enough to attempt — and be
 * denied — cross-tenant service calls. No transactions/batches: every isolation
 * test reaches across into condo A's data, never condo B's.
 */
async function seedSecondaryCondo(
  ctx: PipelineContext,
  slug: string,
): Promise<SecondaryCondo> {
  const { prisma } = ctx;

  const condo = await prisma.condominium.create({
    data: { slug, name: 'Other Tenant Condo' },
  });

  await prisma.condominiumSettings.create({
    data: { condominiumId: condo.id, currency: 'MXN', totalUnits: 5 },
  });

  const user = await prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `actor-${condo.id}@example.test`,
      passwordHash: 'x',
      firstName: 'Other',
      lastName: 'Actor',
    },
  });

  const resident = await prisma.resident.create({
    data: {
      condominiumId: condo.id,
      unitNumber: '202',
      unitNumberNormalized: '202',
      firstName: 'Otro',
      lastName: 'Vecino',
    },
  });

  return { condominiumId: condo.id, userId: user.id, residentId: resident.id };
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

  // ── Manual match ─────────────────────────────────────────────────────────
  // An admin resolves a NEEDS_REVIEW row by hand, linking it to a padrón
  // resident. Verifies the override stamps the row and that the guard clauses
  // reject unknown residents/transactions with NotFoundException (HTTP 404).
  describe('manualMatch', () => {
    it('overrides a NEEDS_REVIEW row: links resident, stamps MANUAL_OVERRIDE', async () => {
      // Auto-classify first so the unidentified deposit is genuinely left for review.
      await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

      const orphan = await ctx.prisma.transaction.findFirstOrThrow({
        where: { condominiumId: fx.condominiumId, description: 'DEPOSITO NO IDENTIFICADO' },
      });
      expect(orphan.classificationStatus).toBe('NEEDS_REVIEW'); // precondition
      expect(orphan.residentId).toBeNull();

      await ctx.classification.manualMatch(
        fx.condominiumId,
        orphan.id,
        fx.residentId,
        fx.importerId,
      );

      const overridden = await ctx.prisma.transaction.findUniqueOrThrow({
        where: { id: orphan.id },
      });
      expect(overridden.classificationStatus).toBe('MANUAL_OVERRIDE');
      expect(overridden.residentId).toBe(fx.residentId);
      expect(overridden.matchSource).toBe('MANUAL');
      expect(Number(overridden.confidenceScore)).toBe(1);
      expect(overridden.matchedAt).not.toBeNull();
      expect(overridden.requiresReviewReason).toBeNull();
      expect(overridden.matchedRuleId).toBeNull();
    });

    it('throws NotFoundException when the resident does not exist', async () => {
      const tx = await ctx.prisma.transaction.findFirstOrThrow({
        where: { condominiumId: fx.condominiumId, description: 'DEPOSITO NO IDENTIFICADO' },
      });

      await expect(
        ctx.classification.manualMatch(
          fx.condominiumId,
          tx.id,
          MISSING_UUID,
          fx.importerId,
        ),
      ).rejects.toThrow('Resident not found in this condominium');
    });

    it('throws NotFoundException when the transaction does not exist', async () => {
      await expect(
        ctx.classification.manualMatch(
          fx.condominiumId,
          MISSING_UUID,
          fx.residentId,
          fx.importerId,
        ),
      ).rejects.toThrow('Transaction not found');
    });
  });

  // ── Reconciliation approval → summary ────────────────────────────────────
  // classifyBatch leaves official totals at 0 (only APPROVED rows count). These
  // tests drive the approval step and assert FinancialMonthlySummary's totals
  // recompute to reflect exactly the approved rows — no more, no less.
  describe('reconciliation approval → summary', () => {
    async function rowByDescription(description: string) {
      return ctx.prisma.transaction.findFirstOrThrow({
        where: { condominiumId: fx.condominiumId, description },
      });
    }

    async function readSummary() {
      return ctx.prisma.financialMonthlySummary.findUniqueOrThrow({
        where: {
          condominiumId_year_month: {
            condominiumId: fx.condominiumId,
            year: YEAR,
            month: MONTH,
          },
        },
      });
    }

    it('approveTransaction stamps the row and lifts the official totals', async () => {
      await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

      // Pre-approval contract: official totals are 0 (no APPROVED rows yet).
      let summary = await readSummary();
      expect(Number(summary.totalExpenses)).toBe(0);
      expect(Number(summary.totalIncome)).toBe(0);

      const expense = await rowByDescription('PAGO CFE LUZ');
      await ctx.classification.approveTransaction(
        fx.condominiumId,
        expense.id,
        fx.importerId,
      );

      const approvedExpense = await ctx.prisma.transaction.findUniqueOrThrow({
        where: { id: expense.id },
      });
      expect(approvedExpense.reconciliationStatus).toBe('APPROVED');
      expect(approvedExpense.reconciledById).toBe(fx.importerId);
      expect(approvedExpense.reconciledAt).not.toBeNull();

      // Only the expense is approved so far: expenses=800, income still 0.
      summary = await readSummary();
      expect(Number(summary.totalExpenses)).toBe(800);
      expect(Number(summary.totalIncome)).toBe(0);

      const income = await rowByDescription('CUOTA101');
      await ctx.classification.approveTransaction(
        fx.condominiumId,
        income.id,
        fx.importerId,
      );

      // CUOTA101 (2000) approved; the unidentified deposit (1500) stays PENDING
      // and must be EXCLUDED — this is the load-bearing assertion that proves
      // the summary counts only APPROVED rows.
      summary = await readSummary();
      expect(Number(summary.totalIncome)).toBe(2000);
      expect(Number(summary.totalExpenses)).toBe(800);
      expect(Number(summary.netBalance)).toBe(1200);
    });

    it('approveTransaction throws NotFoundException for an unknown transaction', async () => {
      await expect(
        ctx.classification.approveTransaction(
          fx.condominiumId,
          MISSING_UUID,
          fx.importerId,
        ),
      ).rejects.toThrow('Transaction not found');
    });

    it('bulkReconcile approve lifts the totals and reports the affected count', async () => {
      await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

      const expense = await rowByDescription('PAGO CFE LUZ');
      const income = await rowByDescription('CUOTA101');

      const result = await ctx.classification.bulkReconcile(
        fx.condominiumId,
        [expense.id, income.id],
        'approve',
        fx.importerId,
      );
      expect(result).toEqual({ affected: 2 });

      const summary = await readSummary();
      expect(Number(summary.totalIncome)).toBe(2000);
      expect(Number(summary.totalExpenses)).toBe(800);
      expect(Number(summary.netBalance)).toBe(1200);
    });

    it('bulkReconcile reopen reverts the totals back to zero', async () => {
      await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);
      const expense = await rowByDescription('PAGO CFE LUZ');
      const income = await rowByDescription('CUOTA101');
      const ids = [expense.id, income.id];

      await ctx.classification.bulkReconcile(fx.condominiumId, ids, 'approve', fx.importerId);
      let summary = await readSummary();
      expect(Number(summary.netBalance)).toBe(1200); // sanity: approved first

      await ctx.classification.bulkReconcile(fx.condominiumId, ids, 'reopen', fx.importerId);

      // Reopen clears APPROVED, so the official totals fall back to 0.
      summary = await readSummary();
      expect(Number(summary.totalIncome)).toBe(0);
      expect(Number(summary.totalExpenses)).toBe(0);
      expect(Number(summary.netBalance)).toBe(0);

      const reopened = await ctx.prisma.transaction.findUniqueOrThrow({
        where: { id: expense.id },
      });
      expect(reopened.reconciliationStatus).toBe('PENDING');
      expect(reopened.reconciledById).toBeNull();
      expect(reopened.reconciledAt).toBeNull();
    });
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────
  // Every service entrypoint scopes its writes by condominiumId. A call carrying
  // tenant B's id must never read or mutate tenant A's rows. Condo A is the
  // beforeEach fixture; condo B is seeded per test.
  describe('tenant isolation', () => {
    let other: SecondaryCondo;

    beforeEach(async () => {
      other = await seedSecondaryCondo(ctx, `it-other-${Date.now()}`);
    });

    it('manualMatch with a foreign condominiumId cannot reach the transaction', async () => {
      const txA = await ctx.prisma.transaction.findFirstOrThrow({
        where: { condominiumId: fx.condominiumId, description: 'DEPOSITO NO IDENTIFICADO' },
      });

      await expect(
        ctx.classification.manualMatch(
          other.condominiumId, // tenant B
          txA.id, // belongs to tenant A
          other.residentId,
          other.userId,
        ),
      ).rejects.toThrow('Transaction not found');
    });

    it('manualMatch rejects a resident from another tenant', async () => {
      const txA = await ctx.prisma.transaction.findFirstOrThrow({
        where: { condominiumId: fx.condominiumId, description: 'DEPOSITO NO IDENTIFICADO' },
      });

      // Transaction is tenant A's, but the resident belongs to tenant B → denied.
      await expect(
        ctx.classification.manualMatch(
          fx.condominiumId,
          txA.id,
          other.residentId, // tenant B's resident
          fx.importerId,
        ),
      ).rejects.toThrow('Resident not found in this condominium');
    });

    it('approveTransaction with a foreign condominiumId cannot approve the row', async () => {
      const txA = await ctx.prisma.transaction.findFirstOrThrow({
        where: { condominiumId: fx.condominiumId, description: 'PAGO CFE LUZ' },
      });

      await expect(
        ctx.classification.approveTransaction(other.condominiumId, txA.id, other.userId),
      ).rejects.toThrow('Transaction not found');

      // The row must remain untouched (still PENDING).
      const untouched = await ctx.prisma.transaction.findUniqueOrThrow({
        where: { id: txA.id },
      });
      expect(untouched.reconciliationStatus).toBe('PENDING');
    });

    it('bulkReconcile rejects a batch containing another tenant\'s ids (ForbiddenException)', async () => {
      const txA = await ctx.prisma.transaction.findFirstOrThrow({
        where: { condominiumId: fx.condominiumId, description: 'PAGO CFE LUZ' },
      });

      await expect(
        ctx.classification.bulkReconcile(
          other.condominiumId, // tenant B
          [txA.id], // tenant A's row
          'approve',
          other.userId,
        ),
      ).rejects.toThrow('do not belong to this condominium');

      const untouched = await ctx.prisma.transaction.findUniqueOrThrow({
        where: { id: txA.id },
      });
      expect(untouched.reconciliationStatus).toBe('PENDING');
    });

    it('classifyBatch scoped to the wrong tenant is a no-op over foreign rows', async () => {
      const summary = await ctx.classification.classifyBatch(
        other.condominiumId, // tenant B
        fx.batchId, // tenant A's batch
      );

      // No rows match (condominiumId B + batch A) → all-zero summary.
      expect(summary).toEqual({ total: 0, classified: 0, needsReview: 0, unmatched: 0 });

      // Condo A's rows must be untouched — still NEEDS_REVIEW, never classified
      // by the foreign-tenant call.
      const aRows = await ctx.prisma.transaction.findMany({
        where: { condominiumId: fx.condominiumId },
      });
      expect(aRows).toHaveLength(3);
      for (const row of aRows) {
        expect(row.classificationStatus).toBe('NEEDS_REVIEW');
      }
    });
  });
});
