import { PettyCashService } from './petty-cash.service';

const CONDOMINIUM_ID = 'cond-1';

interface PrismaMock {
  pettyCashMovement: {
    groupBy: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    pettyCashMovement: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeSettingsCacheMock(currency: string | null = 'USD') {
  return {
    getSettings: jest.fn().mockResolvedValue(currency ? { currency } : null),
  };
}

function makeService(prisma: PrismaMock, settings: ReturnType<typeof makeSettingsCacheMock>) {
  // Cast through unknown — the service only touches the mocked members.
  return new PettyCashService(prisma as never, settings as never);
}

describe('PettyCashService.getCategoryBreakdown', () => {
  it('groups outflows by category, sorts by amount desc and computes percentages', async () => {
    const prisma = makePrismaMock();
    prisma.pettyCashMovement.groupBy.mockResolvedValue([
      { category: 'CLEANING', _sum: { amount: 100 } },
      { category: 'MAINTENANCE', _sum: { amount: 300 } },
      { category: 'WATER', _sum: { amount: 100 } },
    ]);
    const settings = makeSettingsCacheMock('USD');
    const service = makeService(prisma, settings);

    const result = await service.getCategoryBreakdown(CONDOMINIUM_ID, 2026, 6);

    expect(result.currency).toBe('USD');
    expect(result.period).toEqual({ year: 2026, month: 6 });
    expect(result.total).toBe(500);
    expect(result.breakdown.map((b) => b.category)).toEqual([
      'MAINTENANCE',
      'CLEANING',
      'WATER',
    ]);
    expect(result.breakdown[0]).toEqual({
      category: 'MAINTENANCE',
      amount: 300,
      percentage: 60,
    });
  });

  it('only aggregates EXIT/REIMBURSEMENT outflows that are not rejected, within the month', async () => {
    const prisma = makePrismaMock();
    const settings = makeSettingsCacheMock('MXN');
    const service = makeService(prisma, settings);

    await service.getCategoryBreakdown(CONDOMINIUM_ID, 2026, 3);

    const where = prisma.pettyCashMovement.groupBy.mock.calls[0][0].where;
    expect(where.condominiumId).toBe(CONDOMINIUM_ID);
    expect(where.movementType).toEqual({ in: ['EXIT', 'REIMBURSEMENT'] });
    expect(where.status).toEqual({ not: 'REJECTED' });
    expect(where.date.gte).toEqual(new Date(2026, 2, 1));
    expect(where.date.lt).toEqual(new Date(2026, 3, 1));
  });

  it('drops zero/empty buckets and defaults currency to MXN when settings are absent', async () => {
    const prisma = makePrismaMock();
    prisma.pettyCashMovement.groupBy.mockResolvedValue([
      { category: 'CLEANING', _sum: { amount: 50 } },
      { category: 'TOOLS', _sum: { amount: null } },
    ]);
    const settings = makeSettingsCacheMock(null);
    const service = makeService(prisma, settings);

    const result = await service.getCategoryBreakdown(CONDOMINIUM_ID, 2026, 6);

    expect(result.currency).toBe('MXN');
    expect(result.total).toBe(50);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].percentage).toBe(100);
  });

  it('returns an empty breakdown with zero total when there are no movements', async () => {
    const prisma = makePrismaMock();
    const settings = makeSettingsCacheMock('MXN');
    const service = makeService(prisma, settings);

    const result = await service.getCategoryBreakdown(CONDOMINIUM_ID, 2026, 6);

    expect(result.total).toBe(0);
    expect(result.breakdown).toEqual([]);
  });
});
