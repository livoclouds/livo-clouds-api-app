/**
 * ENGINE-025 — the summary window must be UTC regardless of server timezone.
 *
 * These assertions are TZ-independent ONLY when the implementation is correct:
 * run them under several TZs via `pnpm test:tz` (TZ=America/Mexico_City and
 * TZ=UTC in fresh Jest processes — V8 caches the zone per process). The old
 * `new Date(year, month - 1, 1)` construction fails the Mexico_City run.
 */
import {
  monthWindowUtc,
  summaryLockKey,
  upsertSummaryForMonthCore,
} from './monthly-summary.util';

describe('monthWindowUtc (ENGINE-025)', () => {
  it('builds the window at UTC midnights, never server-local', () => {
    const { start, end } = monthWindowUtc(2026, 3);
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('contains a 1st-of-month UTC-midnight transaction in its OWN month', () => {
    const txDate = new Date('2026-03-01T00:00:00.000Z');
    const march = monthWindowUtc(2026, 3);
    const february = monthWindowUtc(2026, 2);
    expect(txDate >= march.start && txDate < march.end).toBe(true);
    expect(txDate >= february.start && txDate < february.end).toBe(false);
  });

  it('handles the December→January year rollover', () => {
    const { start, end } = monthWindowUtc(2025, 12);
    expect(start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('summaryLockKey', () => {
  it('produces distinct int4-safe keys per month', () => {
    expect(summaryLockKey(2026, 3)).toBe(202603);
    expect(summaryLockKey(2026, 12)).toBe(202612);
    expect(summaryLockKey(2026, 3)).not.toBe(summaryLockKey(2026, 4));
    expect(summaryLockKey(2026, 1)).toBeLessThan(2 ** 31);
  });
});

describe('upsertSummaryForMonthCore', () => {
  function makeDb() {
    return {
      transaction: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { credits: null, charges: null }, _count: 0 }),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      financialMonthlySummary: { upsert: jest.fn().mockResolvedValue(null) },
    };
  }

  it('queries with the UTC window and upserts on (condominiumId, year, month)', async () => {
    const db = makeDb();
    await upsertSummaryForMonthCore(db as never, 'cond-1', 2026, 3);

    const aggWhere = db.transaction.aggregate.mock.calls[0][0].where;
    expect(aggWhere.transactionDate.gte.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(aggWhere.transactionDate.lt.toISOString()).toBe('2026-04-01T00:00:00.000Z');

    expect(db.financialMonthlySummary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          condominiumId_year_month: { condominiumId: 'cond-1', year: 2026, month: 3 },
        },
      }),
    );
  });

  it('persists rounded Decimal totals (single rounding authority)', async () => {
    const db = makeDb();
    db.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { credits: 1000.005 }, _count: 2 })
      .mockResolvedValueOnce({ _sum: { charges: 250.004 }, _count: 1 });
    await upsertSummaryForMonthCore(db as never, 'cond-1', 2026, 3);

    const created = db.financialMonthlySummary.upsert.mock.calls[0][0].create;
    expect(created.totalIncome.toString()).toBe('1000.01');
    expect(created.totalExpenses.toString()).toBe('250');
    expect(created.netBalance.toString()).toBe('750.01');
    expect(created.approvedCount).toBe(3);
  });
});
