/**
 * Summary-recompute concurrency — ENGINE-022 / ENGINE-025 / ENGINE-039.
 *
 * Fires concurrent approveTransaction calls + a classifyBatch over ONE month
 * against a REAL Postgres and asserts the persisted FinancialMonthlySummary
 * converges to exactly what a from-scratch recompute produces, with internally
 * consistent counts (pending + approved + ignored = transactionCount).
 *
 * Before Phase 3 the recompute's six reads ran outside any transaction, so a
 * concurrent storm could persist a summary whose counts disagreed with each
 * other; the advisory xact-lock serializes recomputes per (tenant, month).
 *
 * Also pins ENGINE-025: a 1st-of-month UTC-midnight transaction lands in its
 * own month regardless of the server timezone (run under TZ=UTC in CI; the
 * old server-local window construction dropped it on UTC-negative servers).
 */
import { FlowType, ReconciliationStatus } from '@prisma/client';

import {
  closePipelineContext,
  createPipelineContext,
  describeIntegration,
  PipelineContext,
  resetDb,
} from './db';

const YEAR = 2026;
const MONTH = 3;
const TX_COUNT = 12;

interface Fixture {
  condominiumId: string;
  userId: string;
  batchId: string;
  transactionIds: string[];
}

async function seedFixture(ctx: PipelineContext): Promise<Fixture> {
  const { prisma } = ctx;

  const condo = await prisma.condominium.create({
    data: { slug: `it-conc-${Date.now()}`, name: 'Concurrency Test Condo' },
  });
  await prisma.condominiumSettings.create({
    data: { condominiumId: condo.id, currency: 'MXN', totalUnits: 10 },
  });
  const user = await prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `conc-${condo.id}@example.test`,
      passwordHash: 'x',
      firstName: 'Con',
      lastName: 'Currency',
    },
  });
  const bankProfile = await prisma.bankProfile.create({
    data: { condominiumId: condo.id, name: 'Generic', excelAliases: {} },
  });
  const batch = await prisma.importBatch.create({
    data: {
      condominiumId: condo.id,
      importedById: user.id,
      bankProfileId: bankProfile.id,
      fileName: 'concurrency.xlsx',
      fileType: 'xlsx',
      fileSizeBytes: 1024,
      fileHash: `hash-conc-${condo.id}`,
    },
  });

  // ENGINE-025 pin: the first row sits exactly at the 1st-of-month UTC midnight.
  await prisma.transaction.createMany({
    data: Array.from({ length: TX_COUNT }, (_, i) => ({
      condominiumId: condo.id,
      importBatchId: batch.id,
      transactionDate:
        i === 0
          ? new Date(Date.UTC(YEAR, MONTH - 1, 1))
          : new Date(Date.UTC(YEAR, MONTH - 1, 2 + i)),
      description: `DEPOSITO ${i + 1}`,
      credits: 100 + i,
      balance: 0,
      flowType: FlowType.INCOME,
    })),
  });
  const rows = await prisma.transaction.findMany({
    where: { condominiumId: condo.id },
    select: { id: true },
    orderBy: { transactionDate: 'asc' },
  });

  return {
    condominiumId: condo.id,
    userId: user.id,
    batchId: batch.id,
    transactionIds: rows.map((r) => r.id),
  };
}

describeIntegration('FinancialMonthlySummary under concurrency (ENGINE-022/025/039)', () => {
  let ctx: PipelineContext;

  beforeAll(async () => {
    ctx = await createPipelineContext();
  });

  afterAll(async () => {
    if (ctx) await closePipelineContext(ctx);
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  it('concurrent approve×N + classifyBatch converge to the from-scratch summary', async () => {
    const fx = await seedFixture(ctx);

    // The storm: every approve triggers its own month recompute, racing the
    // batch classification's recompute of the same month.
    await Promise.all([
      ...fx.transactionIds.slice(0, 8).map((id) =>
        ctx.classification.approveTransaction(fx.condominiumId, id, fx.userId),
      ),
      ctx.classification.classifyBatch(fx.condominiumId, fx.batchId),
    ]);

    const stored = await ctx.prisma.financialMonthlySummary.findUnique({
      where: {
        condominiumId_year_month: {
          condominiumId: fx.condominiumId,
          year: YEAR,
          month: MONTH,
        },
      },
    });
    expect(stored).not.toBeNull();

    // Internal consistency: the three reconciliation buckets partition the month.
    expect(
      stored!.pendingCount + stored!.approvedCount + stored!.ignoredCount,
    ).toBe(stored!.transactionCount);
    // ENGINE-025: the 1st-of-month row is INSIDE its own month's window.
    expect(stored!.transactionCount).toBe(TX_COUNT);
    expect(stored!.approvedCount).toBe(8);

    // Convergence: a from-scratch recompute must not change anything.
    await ctx.classification.recomputeSummariesForMonths(fx.condominiumId, [
      { year: YEAR, month: MONTH },
    ]);
    const recomputed = await ctx.prisma.financialMonthlySummary.findUnique({
      where: {
        condominiumId_year_month: {
          condominiumId: fx.condominiumId,
          year: YEAR,
          month: MONTH,
        },
      },
    });
    expect(recomputed!.totalIncome.toString()).toBe(stored!.totalIncome.toString());
    expect(recomputed!.totalExpenses.toString()).toBe(stored!.totalExpenses.toString());
    expect(recomputed!.transactionCount).toBe(stored!.transactionCount);
    expect(recomputed!.approvedCount).toBe(stored!.approvedCount);
    expect(recomputed!.pendingCount).toBe(stored!.pendingCount);
    expect(recomputed!.ignoredCount).toBe(stored!.ignoredCount);

    // The approved income equals the sum of the 8 approved rows' credits.
    const approvedAgg = await ctx.prisma.transaction.aggregate({
      where: {
        condominiumId: fx.condominiumId,
        reconciliationStatus: ReconciliationStatus.APPROVED,
      },
      _sum: { credits: true },
    });
    expect(Number(recomputed!.totalIncome)).toBe(
      Number(approvedAgg._sum.credits ?? 0),
    );
  });
});
