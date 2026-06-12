// Monthly-summary recompute (ENGINE-008 decomposition, Phase 6). Owns the
// advisory-locked upsert of FinancialMonthlySummary rows. Extracted verbatim
// from ClassificationService; the facade delegates here so existing callers
// (imports.service, integration specs) keep their entry points.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { summaryLockKey, upsertSummaryForMonthCore } from '../classification/monthly-summary.util';

@Injectable()
export class SummaryRecomputeService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMonthlySummaries(
    condominiumId: string,
    batchId: string,
  ): Promise<void> {
    const periods = await this.prisma.transaction.groupBy({
      by: ['transactionDate'],
      where: { condominiumId, importBatchId: batchId },
    });

    const uniqueMonths = new Set<string>();
    for (const { transactionDate } of periods) {
      const d = new Date(transactionDate);
      uniqueMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
    }

    await this.recomputeMonths(condominiumId, uniqueMonths);
  }

  // ENGINE-002 — public recompute for callers that delete transactions and
  // must rebuild the official monthly numbers afterwards (imports remove()).
  // The month list is captured by the caller BEFORE deleting, because the
  // batch-scoped variant derives its months from rows that no longer exist.
  async recomputeSummariesForMonths(
    condominiumId: string,
    months: Array<{ year: number; month: number }>,
  ): Promise<void> {
    await this.recomputeMonths(
      condominiumId,
      months.map(({ year, month }) => `${year}-${month}`),
    );
  }

  async upsertSummaryForMonth(
    condominiumId: string,
    year: number,
    month: number,
  ): Promise<void> {
    // ENGINE-022 — the six reads + upsert run inside one transaction,
    // serialized per (tenant, month) by a Postgres advisory xact-lock
    // (first advisory-lock use in this codebase). $transaction alone is
    // READ COMMITTED — each statement takes its own snapshot — so without
    // the lock two concurrent recomputes could persist internally
    // inconsistent counts (pending+approved+ignored ≠ transactionCount).
    // pg_advisory_xact_lock(int4, int4): key1 = hashtext(condominiumId),
    // key2 = year*100+month; auto-released at commit/rollback.
    await this.prisma.$transaction(async (tx) => {
      // ::int4 cast — Prisma binds JS numbers as bigint and the two-arg lock
      // only exists as (int4, int4). $executeRaw, not $queryRaw: the lock
      // returns void, which Prisma's result deserializer rejects.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${condominiumId}), ${summaryLockKey(year, month)}::int4)`;
      await upsertSummaryForMonthCore(tx, condominiumId, year, month);
    });
  }

  /**
   * Coalesced month recompute (ENGINE-039): dedupes the month keys and runs
   * the recomputes SEQUENTIALLY — a request touches 1-13 months at most, and
   * a parallel fan-out would only queue on the advisory lock while exhausting
   * the connection pool.
   */
  async recomputeMonths(
    condominiumId: string,
    monthKeys: Iterable<string>,
  ): Promise<void> {
    for (const key of new Set(monthKeys)) {
      const [year, month] = key.split('-').map(Number);
      await this.upsertSummaryForMonth(condominiumId, year, month);
    }
  }
}
