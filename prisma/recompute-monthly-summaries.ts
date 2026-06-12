/**
 * [ENGINE-025] One-off historical recompute of FinancialMonthlySummary rows.
 *
 * Before Phase 3 the monthly-summary window was built in SERVER-LOCAL time
 * while transaction dates are UTC midnights, so on UTC-negative servers every
 * 1st-of-month transaction aggregated into the wrong month. This script
 * recomputes every (condominium, month) summary with the corrected UTC window,
 * reusing the EXACT same aggregation core the service runs
 * (`upsertSummaryForMonthCore`) under the same advisory lock — zero logic
 * duplication, safe to run while the API is live, idempotent.
 *
 * Months are enumerated from BOTH:
 *   - distinct UTC months present in `transactions`, and
 *   - existing `financial_monthly_summaries` rows (phantom summaries created
 *     under the old local-time window get corrected or zeroed).
 *
 * Usage:
 *   pnpm prisma:recompute-summaries                       # all condominiums
 *   pnpm prisma:recompute-summaries -- --condominium <id> # one tenant
 *   pnpm prisma:recompute-summaries -- --dry-run          # report deltas only
 *
 * Prerequisites: DATABASE_URL must point to the target database (dotenv is
 * preloaded by the package.json script — ts-node alone does NOT load .env).
 */

import { PrismaClient } from '@prisma/client';
import {
  summaryLockKey,
  upsertSummaryForMonthCore,
} from '../src/modules/classification/monthly-summary.util';

interface MonthTarget {
  condominiumId: string;
  year: number;
  month: number;
}

function parseArgs(argv: string[]): { condominiumId?: string; dryRun: boolean } {
  const dryRun = argv.includes('--dry-run');
  const condoIdx = argv.indexOf('--condominium');
  const condominiumId =
    condoIdx !== -1 && argv[condoIdx + 1] ? argv[condoIdx + 1] : undefined;
  return { condominiumId, dryRun };
}

async function enumerateTargets(
  prisma: PrismaClient,
  condominiumId?: string,
): Promise<MonthTarget[]> {
  const tenantFilter = condominiumId
    ? `WHERE "condominiumId" = '${condominiumId.replace(/'/g, "''")}'`
    : '';

  // Months with at least one transaction (UTC bucketing — the corrected rule).
  const txMonths = await prisma.$queryRawUnsafe<
    Array<{ condominiumId: string; year: number; month: number }>
  >(
    `SELECT "condominiumId",
            EXTRACT(YEAR FROM "transactionDate" AT TIME ZONE 'UTC')::int AS year,
            EXTRACT(MONTH FROM "transactionDate" AT TIME ZONE 'UTC')::int AS month
       FROM "transactions" ${tenantFilter}
      GROUP BY 1, 2, 3`,
  );

  // Months that only exist as (possibly phantom) summary rows.
  const summaryMonths = await prisma.financialMonthlySummary.findMany({
    where: condominiumId ? { condominiumId } : undefined,
    select: { condominiumId: true, year: true, month: true },
  });

  const seen = new Set<string>();
  const targets: MonthTarget[] = [];
  for (const t of [...txMonths, ...summaryMonths]) {
    const key = `${t.condominiumId}:${t.year}-${t.month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ condominiumId: t.condominiumId, year: t.year, month: t.month });
  }
  targets.sort((a, b) =>
    a.condominiumId !== b.condominiumId
      ? a.condominiumId.localeCompare(b.condominiumId)
      : a.year !== b.year
        ? a.year - b.year
        : a.month - b.month,
  );
  return targets;
}

async function main(): Promise<void> {
  const { condominiumId, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const targets = await enumerateTargets(prisma, condominiumId);
    console.log(
      `recompute-monthly-summaries: ${targets.length} (condominium, month) targets` +
        `${condominiumId ? ` for condominium ${condominiumId}` : ''}${dryRun ? ' [dry-run]' : ''}`,
    );

    let changed = 0;
    for (const target of targets) {
      const before = await prisma.financialMonthlySummary.findUnique({
        where: {
          condominiumId_year_month: {
            condominiumId: target.condominiumId,
            year: target.year,
            month: target.month,
          },
        },
      });

      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${target.condominiumId}), ${summaryLockKey(target.year, target.month)}::int4)`;
          await upsertSummaryForMonthCore(
            tx,
            target.condominiumId,
            target.year,
            target.month,
          );
        });
      }

      const after = dryRun
        ? null
        : await prisma.financialMonthlySummary.findUnique({
            where: {
              condominiumId_year_month: {
                condominiumId: target.condominiumId,
                year: target.year,
                month: target.month,
              },
            },
          });

      const label = `${target.condominiumId} ${target.year}-${String(target.month).padStart(2, '0')}`;
      if (dryRun) {
        console.log(
          `  🔎 ${label}: income=${before?.totalIncome ?? '∅'} expenses=${before?.totalExpenses ?? '∅'} txCount=${before?.transactionCount ?? '∅'} (would recompute)`,
        );
        continue;
      }
      const delta =
        before &&
        after &&
        before.totalIncome.equals(after.totalIncome) &&
        before.totalExpenses.equals(after.totalExpenses) &&
        before.transactionCount === after.transactionCount
          ? 'unchanged'
          : `income ${before?.totalIncome ?? '∅'} → ${after?.totalIncome}, ` +
            `expenses ${before?.totalExpenses ?? '∅'} → ${after?.totalExpenses}, ` +
            `txCount ${before?.transactionCount ?? '∅'} → ${after?.transactionCount}`;
      if (delta !== 'unchanged') changed++;
      console.log(`  ${delta === 'unchanged' ? '✅' : '♻️ '} ${label}: ${delta}`);
    }

    console.log(
      dryRun
        ? `Dry run complete — ${targets.length} targets enumerated, nothing written.`
        : `Done — ${targets.length} summaries recomputed, ${changed} changed.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('recompute-monthly-summaries failed:', err);
  process.exitCode = 1;
});
