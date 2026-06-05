import { ARCO_RESPONSE_BUSINESS_DAYS, computeArcoDueDate } from './arco-due-date.util';

describe('computeArcoDueDate', () => {
  it('adds business days and skips weekends', () => {
    // Thursday 2026-06-04 + 1 business day = Friday 2026-06-05.
    expect(computeArcoDueDate(new Date('2026-06-04'), 1).toISOString().slice(0, 10)).toBe(
      '2026-06-05',
    );
    // Friday + 1 business day skips Sat/Sun → Monday 2026-06-08.
    expect(computeArcoDueDate(new Date('2026-06-05'), 1).toISOString().slice(0, 10)).toBe(
      '2026-06-08',
    );
    // Friday + 2 business days → Tuesday 2026-06-09.
    expect(computeArcoDueDate(new Date('2026-06-05'), 2).toISOString().slice(0, 10)).toBe(
      '2026-06-09',
    );
  });

  it('the default 20-business-day window lands ~4 weeks later (no weekends)', () => {
    const due = computeArcoDueDate(new Date('2026-06-04')); // Thursday
    // 20 business days = 28 calendar days from a Thursday → Thursday 2026-07-02.
    expect(due.toISOString().slice(0, 10)).toBe('2026-07-02');
    expect(due.getDay()).not.toBe(0);
    expect(due.getDay()).not.toBe(6);
    expect(ARCO_RESPONSE_BUSINESS_DAYS).toBe(20);
  });

  it('returns the same day for 0 business days and never mutates the input', () => {
    const from = new Date('2026-06-04T00:00:00Z');
    const due = computeArcoDueDate(from, 0);
    expect(due.toISOString()).toBe(from.toISOString());
    expect(from.toISOString()).toBe('2026-06-04T00:00:00.000Z');
  });

  it('skips official Mexican public holidays', () => {
    // From Monday 2026-09-14: weekends-only, +2 business days would land on
    // Wednesday 2026-09-16 — but that is Independence Day (a holiday), so the
    // deadline rolls to Thursday 2026-09-17.
    expect(computeArcoDueDate(new Date('2026-09-14'), 2).toISOString().slice(0, 10)).toBe(
      '2026-09-17',
    );
    // Tuesday 2026-09-15 → +1 business day skips Wed 09-16 (holiday) → Thu 09-17.
    expect(computeArcoDueDate(new Date('2026-09-15'), 1).toISOString().slice(0, 10)).toBe(
      '2026-09-17',
    );
  });
});
