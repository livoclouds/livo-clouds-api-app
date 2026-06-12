import type { ParsedRow } from './types';
import {
  BALANCE_DISCONTINUITY_THRESHOLD,
  validateBalanceContinuity,
} from './balance-continuity';

function row(
  date: string,
  credits: number,
  charges: number,
  balance: number,
  extra: Partial<ParsedRow> = {},
): ParsedRow {
  return {
    date,
    description: 'ROW',
    credits,
    charges,
    balance,
    flowType: credits > 0 ? 'income' : 'expense',
    ...extra,
  };
}

describe('validateBalanceContinuity (ENGINE-027)', () => {
  it('reports zero breaks for a clean oldest-first statement', () => {
    const report = validateBalanceContinuity([
      row('2026-03-01', 0, 0, 1000),
      row('2026-03-02', 500, 0, 1500),
      row('2026-03-03', 0, 200, 1300),
      row('2026-03-04', 100, 0, 1400),
    ]);
    expect(report).toMatchObject({
      checked: true,
      direction: 'oldest-first',
      totalComparisons: 3,
      discontinuities: 0,
      discontinuityRatio: 0,
    });
  });

  it('detects a newest-first statement and validates it in reverse', () => {
    const report = validateBalanceContinuity([
      row('2026-03-04', 100, 0, 1400),
      row('2026-03-03', 0, 200, 1300),
      row('2026-03-02', 500, 0, 1500),
      row('2026-03-01', 0, 0, 1000),
    ]);
    expect(report).toMatchObject({
      checked: true,
      direction: 'newest-first',
      discontinuities: 0,
    });
  });

  it('pins a single tampered balance with the exact cent delta', () => {
    const report = validateBalanceContinuity([
      row('2026-03-01', 0, 0, 1000),
      row('2026-03-02', 500, 0, 1500),
      row('2026-03-03', 0, 200, 1305), // should be 1300 → +500 cents
    ]);
    expect(report.discontinuities).toBe(1);
    expect(report.sample[0]).toMatchObject({
      rowIndex: 2,
      expectedBalance: 1300,
      actualBalance: 1305,
      deltaCents: 500,
    });
  });

  it('tolerates sub-cent drift (1-cent slack for bank-side rounding)', () => {
    const report = validateBalanceContinuity([
      row('2026-03-01', 0, 0, 1000),
      row('2026-03-02', 500, 0, 1500.01),
    ]);
    expect(report.discontinuities).toBe(0);
  });

  it('skips rows the parser flagged — a rejected row must not fabricate a break', () => {
    const report = validateBalanceContinuity([
      row('2026-03-01', 0, 0, 1000),
      row('2026-03-02', NaN, 0, NaN, {
        parseIssues: [{ field: 'credits', issue: 'unparseable', raw: 'abc' }],
      }),
      row('2026-03-03', 500, 0, 1500),
    ]);
    // The flagged middle row is excluded; 1000 → +500 → 1500 stays continuous.
    expect(report).toMatchObject({ checked: true, discontinuities: 0 });
  });

  it('returns checked=false when there are fewer than 2 usable rows', () => {
    expect(validateBalanceContinuity([row('2026-03-01', 100, 0, 100)])).toMatchObject({
      checked: false,
    });
    expect(validateBalanceContinuity([])).toMatchObject({ checked: false });
  });

  it('returns checked=false when the balance column carries no signal (all zeros)', () => {
    const report = validateBalanceContinuity([
      row('2026-03-01', 100, 0, 0),
      row('2026-03-02', 200, 0, 0),
    ]);
    expect(report.checked).toBe(false);
  });

  it('a heavily inconsistent file crosses the confirm threshold', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      // Balances bear no relation to the movements → every pair breaks.
      row(`2026-03-${String(i + 1).padStart(2, '0')}`, 100, 0, 7919 * (i + 3)),
    );
    const report = validateBalanceContinuity(rows);
    expect(report.discontinuityRatio).toBeGreaterThan(
      BALANCE_DISCONTINUITY_THRESHOLD,
    );
  });
});
