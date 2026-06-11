import { Prisma, ReconciliationStatus } from '@prisma/client';
import { round2 } from '../../common/utils/money.util';

/**
 * FinancialMonthlySummary recompute core (ENGINE-022/025/039).
 *
 * Extracted from ClassificationService so the service (inside an
 * advisory-locked $transaction) and the historical recompute script
 * (prisma/recompute-monthly-summaries.ts) share exactly one aggregation body.
 */

/**
 * UTC month window [start, end) for a summary period (ENGINE-025).
 *
 * Transaction dates are persisted as UTC midnights and month keys derive from
 * getUTC*; the window MUST be built with Date.UTC as well. The previous
 * `new Date(year, month - 1, 1)` used server-local time, so on a UTC-negative
 * server every 1st-of-month transaction fell outside its own month.
 */
export function monthWindowUtc(
  year: number,
  month: number,
): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/**
 * Two-int key pair for pg_advisory_xact_lock(int4, int4): the tenant hash is
 * computed in SQL via hashtext(condominiumId); this is the second key. The
 * pair serializes recomputes per (tenant, month) — year*100+month fits int4
 * comfortably through year 21474835.
 */
export function summaryLockKey(year: number, month: number): number {
  return year * 100 + month;
}

/** Minimal Prisma surface the recompute needs — satisfied by both the service's
 *  TransactionClient and a raw PrismaClient inside $transaction. */
export type SummaryDbClient = Pick<
  Prisma.TransactionClient,
  'transaction' | 'financialMonthlySummary'
>;

/**
 * The six reads + upsert of one (condominium, year, month) summary.
 * Callers are responsible for serialization (advisory lock + $transaction);
 * this body only aggregates and writes.
 */
export async function upsertSummaryForMonthCore(
  db: SummaryDbClient,
  condominiumId: string,
  year: number,
  month: number,
): Promise<void> {
  const { start, end } = monthWindowUtc(year, month);

  // Only APPROVED transactions affect official income/expense totals
  const [incomeAgg, expenseAgg, classificationCounts, reconciliationCounts] =
    await Promise.all([
      db.transaction.aggregate({
        where: {
          condominiumId,
          flowType: 'INCOME',
          transactionDate: { gte: start, lt: end },
          reconciliationStatus: ReconciliationStatus.APPROVED,
        },
        _sum: { credits: true },
        _count: true,
      }),
      db.transaction.aggregate({
        where: {
          condominiumId,
          flowType: 'EXPENSE',
          transactionDate: { gte: start, lt: end },
          reconciliationStatus: ReconciliationStatus.APPROVED,
        },
        _sum: { charges: true },
        _count: true,
      }),
      db.transaction.groupBy({
        by: ['classificationStatus'],
        where: { condominiumId, transactionDate: { gte: start, lt: end } },
        _count: true,
      }),
      db.transaction.groupBy({
        by: ['reconciliationStatus'],
        where: { condominiumId, transactionDate: { gte: start, lt: end } },
        _count: true,
      }),
    ]);

  const totalIncome = round2(Number(incomeAgg._sum.credits ?? 0));
  const totalExpenses = round2(Number(expenseAgg._sum.charges ?? 0));
  const approvedCount = incomeAgg._count + expenseAgg._count;

  const totalAll = await db.transaction.count({
    where: { condominiumId, transactionDate: { gte: start, lt: end } },
  });

  const classifiedCount =
    classificationCounts.find((s) => s.classificationStatus === 'AUTO')?._count ?? 0;
  const needsReviewCount =
    classificationCounts.find((s) => s.classificationStatus === 'NEEDS_REVIEW')?._count ?? 0;

  const pendingCount =
    reconciliationCounts.find((s) => s.reconciliationStatus === 'PENDING')?._count ?? 0;
  const ignoredCount =
    reconciliationCounts.find((s) => s.reconciliationStatus === 'IGNORED')?._count ?? 0;

  const unmatchedRows = await db.transaction.count({
    where: {
      condominiumId,
      transactionDate: { gte: start, lt: end },
      classificationStatus: 'NEEDS_REVIEW',
      residentId: null,
    },
  });

  const summaryValues = {
    totalIncome: new Prisma.Decimal(totalIncome.toFixed(2)),
    totalExpenses: new Prisma.Decimal(totalExpenses.toFixed(2)),
    netBalance: new Prisma.Decimal(round2(totalIncome - totalExpenses).toFixed(2)),
    transactionCount: totalAll,
    classifiedCount,
    needsReviewCount,
    unmatchedCount: unmatchedRows,
    approvedCount,
    pendingCount,
    ignoredCount,
  };

  await db.financialMonthlySummary.upsert({
    where: { condominiumId_year_month: { condominiumId, year, month } },
    create: { condominiumId, year, month, ...summaryValues },
    update: summaryValues,
  });
}
