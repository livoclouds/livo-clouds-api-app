import { computeFinalBalance } from './types';

describe('computeFinalBalance (ENGINE-026)', () => {
  it('returns the balance of the chronologically latest row regardless of array order', () => {
    const rows = [
      { date: '2026-01-20', balance: 300 },
      { date: '2026-01-05', balance: 100 },
      { date: '2026-01-15', balance: 200 },
    ];
    expect(computeFinalBalance(rows)).toBe(300);
    expect(computeFinalBalance([...rows].reverse())).toBe(300);
  });

  it('tie-breaks equal dates by the last row in file order (intra-day closing balance)', () => {
    expect(
      computeFinalBalance([
        { date: '2026-01-20', balance: 300 },
        { date: '2026-01-20', balance: 450 },
        { date: '2026-01-20', balance: 425 },
      ]),
    ).toBe(425);
  });

  it('returns 0 for an empty set and skips unparseable dates', () => {
    expect(computeFinalBalance([])).toBe(0);
    expect(
      computeFinalBalance([
        { date: 'not-a-date', balance: 999 },
        { date: '2026-01-10', balance: 50 },
      ]),
    ).toBe(50);
  });
});
