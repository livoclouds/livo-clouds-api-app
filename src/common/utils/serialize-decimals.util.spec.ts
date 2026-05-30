import { Prisma } from '@prisma/client';
import { serializeDecimals } from './serialize-decimals.util';

describe('serializeDecimals', () => {
  it('converts a top-level Decimal to a number', () => {
    expect(serializeDecimals(new Prisma.Decimal('500.00'))).toBe(500);
  });

  it('converts Decimal fields inside a plain object', () => {
    const input = {
      id: 'tx-1',
      charges: new Prisma.Decimal('25000.00'),
      credits: null,
      balance: new Prisma.Decimal('320638.37'),
      description: 'SPEI',
    };

    expect(serializeDecimals(input)).toEqual({
      id: 'tx-1',
      charges: 25000,
      credits: null,
      balance: 320638.37,
      description: 'SPEI',
    });
  });

  it('converts Decimals inside arrays of entities', () => {
    const input = [
      { credits: new Prisma.Decimal('500.00'), charges: null },
      { credits: null, charges: new Prisma.Decimal('1700.50') },
    ];

    expect(serializeDecimals(input)).toEqual([
      { credits: 500, charges: null },
      { credits: null, charges: 1700.5 },
    ]);
  });

  it('converts Decimals inside nested relations and paginated envelopes', () => {
    const input = {
      data: [
        {
          credits: new Prisma.Decimal('500.00'),
          resident: { debt: new Prisma.Decimal('1200.00') },
        },
      ],
      meta: { total: 1, page: 1, limit: 15, totalPages: 1 },
    };

    expect(serializeDecimals(input)).toEqual({
      data: [{ credits: 500, resident: { debt: 1200 } }],
      meta: { total: 1, page: 1, limit: 15, totalPages: 1 },
    });
  });

  it('preserves confidenceScore precision (Decimal(5,4))', () => {
    const input = { confidenceScore: new Prisma.Decimal('0.9500') };
    expect(serializeDecimals(input)).toEqual({ confidenceScore: 0.95 });
  });

  it('leaves Date instances untouched', () => {
    const date = new Date('2026-04-30T00:00:00.000Z');
    const result = serializeDecimals({ transactionDate: date });
    expect(result.transactionDate).toBeInstanceOf(Date);
    expect(result.transactionDate.getTime()).toBe(date.getTime());
  });

  it('passes through null, undefined and primitives', () => {
    expect(serializeDecimals(null)).toBeNull();
    expect(serializeDecimals(undefined)).toBeUndefined();
    expect(serializeDecimals(42)).toBe(42);
    expect(serializeDecimals('hello')).toBe('hello');
    expect(serializeDecimals(true)).toBe(true);
  });

  it('does not mutate the original object', () => {
    const decimal = new Prisma.Decimal('10.00');
    const input = { amount: decimal };
    serializeDecimals(input);
    expect(input.amount).toBe(decimal);
    expect(input.amount).toBeInstanceOf(Prisma.Decimal);
  });
});
