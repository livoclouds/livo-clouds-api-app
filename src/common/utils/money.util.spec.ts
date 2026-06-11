import { fromCents, round2, sumAmounts, toCents } from './money.util';

describe('money.util', () => {
  describe('toCents', () => {
    it('converts plain amounts to integer cents', () => {
      expect(toCents(12.34)).toBe(1234);
      expect(toCents(0)).toBe(0);
      expect(toCents(1500)).toBe(150000);
    });

    it('rounds half away from zero symmetrically', () => {
      expect(toCents(1.005)).toBe(101);
      expect(toCents(-1.005)).toBe(-101);
      expect(toCents(2.675)).toBe(268);
      expect(toCents(-2.675)).toBe(-268);
    });

    it('absorbs binary float noise', () => {
      expect(toCents(0.1 + 0.2)).toBe(30);
      expect(toCents(1.1 + 2.2)).toBe(330);
    });

    it('returns NaN for non-finite input instead of coercing', () => {
      expect(toCents(NaN)).toBeNaN();
      expect(toCents(Infinity)).toBeNaN();
      expect(toCents(-Infinity)).toBeNaN();
    });
  });

  describe('fromCents', () => {
    it('converts cents back to amounts', () => {
      expect(fromCents(1234)).toBe(12.34);
      expect(fromCents(-101)).toBe(-1.01);
      expect(fromCents(0)).toBe(0);
    });

    it('passes NaN through', () => {
      expect(fromCents(NaN)).toBeNaN();
    });
  });

  describe('round2', () => {
    it('rounds to 2 decimals half away from zero', () => {
      expect(round2(1.005)).toBe(1.01);
      expect(round2(-1.005)).toBe(-1.01);
      expect(round2(0.1 + 0.2)).toBe(0.3);
      expect(round2(1234.5678)).toBe(1234.57);
      expect(round2(-1234.5678)).toBe(-1234.57);
    });

    it('is idempotent on already-rounded values', () => {
      expect(round2(99.99)).toBe(99.99);
      expect(round2(-0.01)).toBe(-0.01);
    });

    it('passes NaN/Infinity through as NaN — never 0', () => {
      expect(round2(NaN)).toBeNaN();
      expect(round2(Infinity)).toBeNaN();
    });
  });

  describe('sumAmounts', () => {
    it('sums in cent space, avoiding float accumulation error', () => {
      expect(sumAmounts([0.1, 0.2])).toBe(0.3);
      expect(sumAmounts([10.01, 20.02, 30.03])).toBe(60.06);
    });

    it('treats null/undefined as 0', () => {
      expect(sumAmounts([1.5, null, undefined, 2.5])).toBe(4);
      expect(sumAmounts([])).toBe(0);
    });

    it('poisons the sum to NaN on non-finite entries', () => {
      expect(sumAmounts([1, NaN, 2])).toBeNaN();
      expect(sumAmounts([Infinity])).toBeNaN();
    });
  });
});
