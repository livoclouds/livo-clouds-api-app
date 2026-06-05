import {
  buildScoreHistory,
  computeFinancialHealth,
  HEALTH_WEIGHTS,
  ScoreRecordInput,
  ScoreSummaryInput,
} from './financial-health.util';

const NOW = new Date('2026-06-15T00:00:00Z');

function rec(
  status: string,
  year: number,
  month: number,
  over: Partial<ScoreRecordInput> = {},
): ScoreRecordInput {
  const paid = status === 'PAID_ON_TIME' || status === 'PAID_LATE' ? 1000 : 0;
  return { year, month, status, amountPaid: paid, amountExpected: 1000, ...over };
}

function summary(over: Partial<ScoreSummaryInput> = {}): ScoreSummaryInput {
  return {
    totalPaid: 0,
    totalExpected: 0,
    monthsPaid: 0,
    monthsUnpaid: 0,
    balance: 0,
    ...over,
  };
}

function factor(h: ReturnType<typeof computeFinancialHealth>, key: string) {
  return h.factors.find((f) => f.key === key)!;
}

describe('computeFinancialHealth', () => {
  it('scores a perfect on-time, no-debt resident at 100 / excellent', () => {
    const records = Array.from({ length: 6 }, (_, i) => rec('PAID_ON_TIME', 2026, i + 1));
    const h = computeFinancialHealth(
      summary({ monthsPaid: 6, totalExpected: 6000, totalPaid: 6000, balance: 0 }),
      records,
      NOW,
    );
    expect(h.score).toBe(100);
    expect(h.band).toBe('excellent');
    expect(h.hasData).toBe(true);
    expect(h.factors).toHaveLength(7);
  });

  it('drives a chronically delinquent resident into at_risk', () => {
    const records = Array.from({ length: 8 }, (_, i) => rec('UNPAID', 2025, i + 1));
    const h = computeFinancialHealth(
      summary({ monthsUnpaid: 8, totalExpected: 8000, balance: 8000 }),
      records,
      NOW,
    );
    expect(h.band).toBe('at_risk');
    expect(h.score).toBeLessThan(30);
  });

  it('collection rate reflects amount paid vs expected', () => {
    // Two months, each expected 1000, one fully paid one unpaid → 50%.
    const records = [
      rec('PAID_ON_TIME', 2026, 1),
      rec('UNPAID', 2026, 2),
    ];
    const h = computeFinancialHealth(summary({ monthsUnpaid: 1, totalExpected: 2000 }), records, NOW);
    const cr = factor(h, 'collectionRate');
    expect(cr.rawValue).toBe(50);
    expect(cr.contribution).toBe(Math.round(0.5 * HEALTH_WEIGHTS.collectionRate));
  });

  it('delinquency age penalises an older unpaid month more', () => {
    const recent = computeFinancialHealth(summary({ monthsUnpaid: 1 }), [rec('UNPAID', 2026, 5)], NOW);
    const old = computeFinancialHealth(summary({ monthsUnpaid: 1 }), [rec('UNPAID', 2025, 5)], NOW);
    expect(factor(recent, 'delinquencyAge').rawValue).toBe(1); // 1 month overdue (May→Jun)
    expect(factor(old, 'delinquencyAge').rawValue).toBe(13); // 13 months overdue
    expect(factor(old, 'delinquencyAge').contribution).toBeLessThan(
      factor(recent, 'delinquencyAge').contribution,
    );
  });

  it('balance factor: positive balance is debt and is penalised; <= 0 is perfect', () => {
    const debt = computeFinancialHealth(summary({ balance: 5000, totalExpected: 5000 }), [], NOW);
    const credit = computeFinancialHealth(summary({ balance: -500, totalExpected: 1000 }), [], NOW);
    expect(factor(debt, 'balance').rawValue).toBe(5000);
    expect(factor(debt, 'balance').contribution).toBe(0);
    expect(factor(credit, 'balance').contribution).toBe(HEALTH_WEIGHTS.balance);
    expect(factor(credit, 'balance').rawValue).toBe(-500);
  });

  it('recurrence counts recent problem months (chronicity)', () => {
    const records = [
      rec('PAID_LATE', 2026, 1),
      rec('PARTIAL', 2026, 2),
      rec('UNPAID', 2026, 3),
      rec('PAID_ON_TIME', 2026, 4),
    ];
    const h = computeFinancialHealth(summary({ monthsUnpaid: 1 }), records, NOW);
    expect(factor(h, 'recurrence').rawValue).toBe(3); // late + partial + unpaid
  });

  it('trend: a worsening run costs points; improving/stable keeps full credit', () => {
    // Prior 6 on-time, recent 6 unpaid → worsening (delta -1) → trend 0.
    const worsening = [
      ...Array.from({ length: 6 }, (_, i) => rec('PAID_ON_TIME', 2025, i + 1)),
      ...Array.from({ length: 6 }, (_, i) => rec('UNPAID', 2025, i + 7)),
    ];
    const hWorse = computeFinancialHealth(summary({ monthsUnpaid: 6 }), worsening, NOW);
    expect(factor(hWorse, 'trend').rawValue).toBe(-100);
    expect(factor(hWorse, 'trend').contribution).toBe(0);

    // Prior 6 unpaid, recent 6 on-time → improving (delta +1) → full credit.
    const improving = [
      ...Array.from({ length: 6 }, (_, i) => rec('UNPAID', 2025, i + 1)),
      ...Array.from({ length: 6 }, (_, i) => rec('PAID_ON_TIME', 2025, i + 7)),
    ];
    const hBetter = computeFinancialHealth(summary({ monthsUnpaid: 6 }), improving, NOW);
    expect(factor(hBetter, 'trend').rawValue).toBe(100);
    expect(factor(hBetter, 'trend').contribution).toBe(HEALTH_WEIGHTS.trend);
  });

  it('treats a brand-new resident (no counted months) as neutral punctuality', () => {
    const h = computeFinancialHealth(summary(), [rec('PENDING', 2026, 6)], NOW);
    expect(factor(h, 'onTime').contribution).toBe(HEALTH_WEIGHTS.onTime);
    expect(factor(h, 'onTime').rawValue).toBe(100);
  });

  it('excludes agreement/pending from punctuality', () => {
    const records = [
      rec('PAID_ON_TIME', 2026, 1),
      rec('AGREEMENT', 2026, 2),
      rec('PENDING', 2026, 3),
    ];
    const h = computeFinancialHealth(summary({ monthsPaid: 1 }), records, NOW);
    expect(factor(h, 'onTime').rawValue).toBe(100);
  });

  it('flags hasData=false for an empty, zero-balance statement', () => {
    expect(computeFinancialHealth(summary(), [], NOW).hasData).toBe(false);
  });

  it('exposes every factor with raw value, weight and a capped contribution', () => {
    const h = computeFinancialHealth(
      summary({ monthsUnpaid: 3, balance: 1000, totalExpected: 2000 }),
      [rec('PAID_LATE', 2026, 1)],
      NOW,
    );
    expect(h.factors).toHaveLength(7);
    for (const f of h.factors) {
      expect(f).toHaveProperty('rawValue');
      expect(f.contribution).toBeLessThanOrEqual(f.weight);
    }
    const total = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});

describe('buildScoreHistory', () => {
  it('emits one point per month that has records, as of that month', () => {
    const records = [
      rec('PAID_ON_TIME', 2026, 1),
      rec('PAID_ON_TIME', 2026, 2),
      rec('UNPAID', 2026, 3),
    ];
    const hist = buildScoreHistory(records, 12, NOW);
    // Months Jan–Jun 2026 have records up to them (Jan..Jun); earlier months skipped.
    expect(hist.length).toBeGreaterThan(0);
    const jan = hist.find((p) => p.year === 2026 && p.month === 1)!;
    const mar = hist.find((p) => p.year === 2026 && p.month === 3)!;
    expect(jan).toBeTruthy();
    expect(mar).toBeTruthy();
    // The unpaid March lowers the as-of score vs the clean January.
    expect(mar.score).toBeLessThan(jan.score);
  });

  it('skips months with no records yet', () => {
    const hist = buildScoreHistory([rec('PAID_ON_TIME', 2026, 6)], 12, NOW);
    // Only June has any record up to it.
    expect(hist.every((p) => p.year === 2026 && p.month >= 6)).toBe(true);
  });

  it('returns empty for a resident with no records', () => {
    expect(buildScoreHistory([], 12, NOW)).toEqual([]);
  });
});
