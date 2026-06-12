/**
 * ENGINE-058 — precision-harness integration test.
 *
 * Drives ClassificationMetricsService.getPrecisionMetrics against a REAL
 * Postgres: the override numerator comes from the immutable audit_logs rows the
 * manual-correction paths write, and the denominator from surviving AUTO rows
 * on the live transactions table. The unit spec (classification-metrics.
 * service.spec.ts) locks the aggregation math over a mocked Prisma; this suite
 * proves the END-TO-END contract — that manualMatch really produces the audit
 * shape the harness queries (module/action/beforeState JSONB), that
 * NEEDS_REVIEW completions are excluded, and that tenant scoping holds.
 *
 * Fixture rows (same as pipeline.integration.spec.ts): after classifyBatch,
 * 2 rows are AUTO (CFE expense via EXPENSE rule, CUOTA101 via UNIT rule) and
 * 1 row (the unidentified deposit) is NEEDS_REVIEW.
 */
import { FlowType, ReconciliationRuleKind } from '@prisma/client';

import { ClassificationMetricsService } from '../../src/modules/classification/classification-metrics.service';
import type { PrecisionMetrics } from '../../src/modules/classification/classification-metrics.service';
import {
  closePipelineContext,
  createPipelineContext,
  describeIntegration,
  PipelineContext,
  resetDb,
} from './db';

const TX_DATE = new Date('2026-03-15');

interface SeededFixture {
  condominiumId: string;
  batchId: string;
  expenseCategoryId: string;
  residentId: string;
  expenseRuleId: string;
  importerId: string;
}

/**
 * Seeds one tenant with the canonical 3-row batch (2 auto-classifiable, 1
 * orphan). Mirrors the pipeline fixture so the classification outcome is the
 * proven-deterministic {classified: 2, needsReview: 1, unmatched: 1}.
 */
async function seedTenantFixture(
  ctx: PipelineContext,
  slug: string,
): Promise<SeededFixture> {
  const { prisma } = ctx;

  const condo = await prisma.condominium.create({
    data: { slug, name: `Precision Condo ${slug}` },
  });

  await prisma.condominiumSettings.create({
    data: { condominiumId: condo.id, currency: 'MXN', totalUnits: 10 },
  });

  const importer = await prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `importer-${condo.id}@example.test`,
      passwordHash: 'x',
      firstName: 'Imp',
      lastName: 'Orter',
    },
  });

  const category = await prisma.expenseCategory.create({
    data: { condominiumId: condo.id, name: 'Electricidad', systemKey: 'UTILITIES' },
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
      fileName: 'estado-marzo.xlsx',
      fileType: 'xlsx',
      fileSizeBytes: 1024,
      fileHash: `hash-${condo.id}`,
    },
  });

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

function totalOverridden(metrics: PrecisionMetrics): number {
  return metrics.byMatchSource.reduce((sum, b) => sum + b.overridden, 0);
}

function totalStillAuto(metrics: PrecisionMetrics): number {
  return metrics.byMatchSource.reduce((sum, b) => sum + b.stillAuto, 0);
}

describeIntegration('classification precision harness (integration)', () => {
  let ctx: PipelineContext;
  let metricsService: ClassificationMetricsService;
  let fx: SeededFixture;

  beforeAll(async () => {
    ctx = await createPipelineContext();
    // The harness only depends on PrismaService — instantiate it directly with
    // the context's connected client instead of growing the DI module.
    metricsService = new ClassificationMetricsService(ctx.prisma);
  });

  afterAll(async () => {
    if (ctx) await closePipelineContext(ctx);
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    fx = await seedTenantFixture(ctx, `it-prec-${Date.now()}`);
  });

  async function rowByDescription(condominiumId: string, description: string) {
    return ctx.prisma.transaction.findFirstOrThrow({
      where: { condominiumId, description },
    });
  }

  it('reports zero overrides immediately after classifyBatch (everything stillAuto)', async () => {
    const summary = await ctx.classification.classifyBatch(
      fx.condominiumId,
      fx.batchId,
    );
    expect(summary.classified).toBe(2); // precondition

    const metrics = await metricsService.getPrecisionMetrics(fx.condominiumId);

    // Both AUTO rows survive untouched; no correction audits exist yet.
    expect(totalStillAuto(metrics)).toBe(2);
    expect(totalOverridden(metrics)).toBe(0);
    for (const bucket of metrics.byMatchSource) {
      expect(bucket.overridden).toBe(0);
      expect(bucket.overrideRate).toBe(0);
      expect(bucket.autoTotal).toBe(bucket.stillAuto);
    }
    for (const bucket of metrics.byRule) {
      expect(bucket.overridden).toBe(0);
      expect(bucket.overrideRate).toBe(0);
    }
  });

  it('counts a manualMatch over an AUTO row as one override for its matchSource', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    // Capture the engine's stamp BEFORE the override — manualMatch rewrites
    // matchSource to MANUAL, so the live row alone cannot tell us the bucket.
    const autoRow = await rowByDescription(fx.condominiumId, 'CUOTA101');
    expect(autoRow.classificationStatus).toBe('AUTO'); // precondition
    expect(autoRow.matchSource).not.toBeNull();
    const engineSource = autoRow.matchSource!;
    const autoWithSameSource = await ctx.prisma.transaction.count({
      where: {
        condominiumId: fx.condominiumId,
        classificationStatus: 'AUTO',
        matchSource: engineSource,
      },
    });

    await ctx.classification.manualMatch(
      fx.condominiumId,
      autoRow.id,
      fx.residentId,
      fx.importerId,
    );

    const metrics = await metricsService.getPrecisionMetrics(fx.condominiumId);
    const bucket = metrics.byMatchSource.find(
      (b) => b.matchSource === engineSource,
    );
    expect(bucket).toBeDefined();
    expect(bucket!.overridden).toBe(1);
    // The denominator is stillAuto + overridden — the override moved one row
    // out of AUTO but it still counts toward what the engine had classified.
    expect(bucket!.stillAuto).toBe(autoWithSameSource - 1);
    expect(bucket!.autoTotal).toBe(autoWithSameSource);
    expect(bucket!.overrideRate).toBe(
      Math.round((1 / autoWithSameSource) * 10_000) / 10_000,
    );
    expect(totalOverridden(metrics)).toBe(1);
  });

  it('does NOT count a manualMatch over a NEEDS_REVIEW row as an override', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    const orphan = await rowByDescription(
      fx.condominiumId,
      'DEPOSITO NO IDENTIFICADO',
    );
    expect(orphan.classificationStatus).toBe('NEEDS_REVIEW'); // precondition

    // Completing a review-queue row is the engine WORKING AS DESIGNED — the
    // audit beforeState carries classificationStatus NEEDS_REVIEW, which the
    // harness filters out of the numerator.
    await ctx.classification.manualMatch(
      fx.condominiumId,
      orphan.id,
      fx.residentId,
      fx.importerId,
    );

    const metrics = await metricsService.getPrecisionMetrics(fx.condominiumId);
    expect(totalOverridden(metrics)).toBe(0);
    expect(totalStillAuto(metrics)).toBe(2); // both AUTO rows untouched
    for (const bucket of metrics.byMatchSource) {
      expect(bucket.overrideRate).toBe(0);
    }
  });

  it('attributes an override of a RULE-matched row to its matchedRuleId in byRule', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    // The CFE expense is the row with a proven matchedRuleId stamp.
    const expense = await rowByDescription(fx.condominiumId, 'PAGO CFE LUZ');
    expect(expense.matchedRuleId).toBe(fx.expenseRuleId); // precondition
    expect(expense.classificationStatus).toBe('AUTO');

    await ctx.classification.manualMatch(
      fx.condominiumId,
      expense.id,
      fx.residentId,
      fx.importerId,
    );

    const metrics = await metricsService.getPrecisionMetrics(fx.condominiumId);
    const ruleBucket = metrics.byRule.find((b) => b.ruleId === fx.expenseRuleId);
    expect(ruleBucket).toBeDefined();
    expect(ruleBucket!.ruleName).toBe('CFE → Electricidad');
    expect(ruleBucket!.overridden).toBe(1);
    // manualMatch nulls matchedRuleId on the live row, so the audit trail is
    // the ONLY surviving attribution — that is exactly what byRule must read.
    const stillAutoForRule = await ctx.prisma.transaction.count({
      where: {
        condominiumId: fx.condominiumId,
        classificationStatus: 'AUTO',
        matchedRuleId: fx.expenseRuleId,
      },
    });
    expect(ruleBucket!.stillAuto).toBe(stillAutoForRule);
    expect(ruleBucket!.autoTotal).toBe(stillAutoForRule + 1);
  });

  it('reclassifyBatch refreshes the persisted batch summary columns', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    // The batch was created directly (not via confirm), so the persisted
    // summary columns still hold their pre-harness defaults.
    const before = await ctx.prisma.importBatch.findUniqueOrThrow({
      where: { id: fx.batchId },
    });
    expect(before.classifiedAt).toBeNull();

    const summary = await ctx.classification.reclassifyBatch(
      fx.condominiumId,
      fx.batchId,
      fx.importerId,
    );
    expect(summary).toEqual({
      total: 3,
      classified: 2,
      needsReview: 1,
      unmatched: 1,
      // ENGINE-018/003: re-run with no concurrent edits and no manual rows.
      skipped: 0,
      preservedManual: 0,
    });

    const after = await ctx.prisma.importBatch.findUniqueOrThrow({
      where: { id: fx.batchId },
    });
    expect(after.classifiedCount).toBe(2);
    expect(after.needsReviewCount).toBe(1);
    expect(after.unmatchedCount).toBe(1);
    expect(after.classifiedAt).not.toBeNull();
  });

  it('never leaks a second tenant\'s overrides into the first tenant\'s rates', async () => {
    await ctx.classification.classifyBatch(fx.condominiumId, fx.batchId);

    // Tenant B: full fixture, classified, then one genuine override.
    const other = await seedTenantFixture(ctx, `it-prec-other-${Date.now()}`);
    await ctx.classification.classifyBatch(other.condominiumId, other.batchId);
    const otherAuto = await rowByDescription(other.condominiumId, 'CUOTA101');
    expect(otherAuto.classificationStatus).toBe('AUTO');
    await ctx.classification.manualMatch(
      other.condominiumId,
      otherAuto.id,
      other.residentId,
      other.importerId,
    );

    // Tenant A's rates are untouched by tenant B's correction…
    const metricsA = await metricsService.getPrecisionMetrics(fx.condominiumId);
    expect(totalOverridden(metricsA)).toBe(0);
    expect(totalStillAuto(metricsA)).toBe(2);
    for (const bucket of metricsA.byMatchSource) {
      expect(bucket.overrideRate).toBe(0);
    }

    // …while tenant B's own metrics do register it (the audit row exists).
    const metricsB = await metricsService.getPrecisionMetrics(
      other.condominiumId,
    );
    expect(totalOverridden(metricsB)).toBe(1);
  });
});
