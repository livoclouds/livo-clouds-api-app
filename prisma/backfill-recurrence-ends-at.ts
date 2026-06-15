/**
 * [CAL-040] One-off backfill of CalendarEvent.recurrenceEndsAt.
 *
 * The denormalized, indexed `recurrenceEndsAt` column (the end instant of a
 * recurring series' last occurrence, derived from the RRULE UNTIL/COUNT) lets
 * the recurring-parent read be DB-bounded instead of scanning every recurring
 * parent over a tenant's lifetime. New/updated events set it on write; this
 * script populates it for rows that predate the column (where it is still NULL).
 *
 * NULL is the safe "open / never expires" sentinel — the read keeps NULL rows —
 * so running this is an OPTIMIZATION (it makes the DB bound effective for legacy
 * rows), not a correctness requirement. Idempotent: only NULL rows are touched,
 * and it reuses the exact same `computeRecurrenceEnd` the service writes with.
 *
 * Usage:
 *   pnpm prisma:backfill-recurrence-ends            # all tenants
 *   pnpm prisma:backfill-recurrence-ends -- --dry-run
 *
 * Prerequisites: DATABASE_URL must point to the target database (dotenv is
 * preloaded by the package.json script — ts-node alone does NOT load .env).
 */

import { PrismaClient } from '@prisma/client';
import { computeRecurrenceEnd } from '../src/modules/calendar/recurrence';

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  const prisma = new PrismaClient();

  try {
    // Only rows that have a rule but no denormalized end yet (legacy / pre-column).
    const rows = await prisma.calendarEvent.findMany({
      where: { recurrenceRule: { not: null }, recurrenceEndsAt: null },
      select: { id: true, startDate: true, endDate: true, recurrenceRule: true },
    });

    console.log(
      `backfill-recurrence-ends-at: ${rows.length} recurring event(s) to backfill${dryRun ? ' [dry-run]' : ''}`,
    );

    let updated = 0;
    let leftOpen = 0;
    for (const row of rows) {
      const end =
        row.recurrenceRule != null
          ? computeRecurrenceEnd(row.recurrenceRule, row.startDate, row.endDate)
          : null;

      if (end == null) {
        // Unparseable / truly unbounded → leave NULL (kept by the read).
        leftOpen++;
        console.log(`  ⏭️  ${row.id}: rule has no computable end — left open (NULL)`);
        continue;
      }

      if (!dryRun) {
        await prisma.calendarEvent.update({
          where: { id: row.id },
          data: { recurrenceEndsAt: end },
        });
      }
      updated++;
      console.log(`  ${dryRun ? '🔎' : '♻️ '} ${row.id}: recurrenceEndsAt → ${end.toISOString()}`);
    }

    console.log(
      dryRun
        ? `Dry run complete — ${updated} would be set, ${leftOpen} left open, nothing written.`
        : `Done — ${updated} backfilled, ${leftOpen} left open.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('backfill-recurrence-ends-at failed:', err);
  process.exitCode = 1;
});
