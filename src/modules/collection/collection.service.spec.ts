import { NotFoundException } from '@nestjs/common';
import { CollectionService } from './collection.service';

const CONDOMINIUM_ID = 'cond-1';
const RESIDENT_ID = 'res-1';

interface PrismaMock {
  resident: {
    findFirst: jest.Mock;
  };
  transaction: {
    findMany: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
  };
  collectionRecord: {
    findMany: jest.Mock;
    count: jest.Mock;
    groupBy: jest.Mock;
  };
  paymentAllocation: {
    aggregate: jest.Mock;
  };
  condominiumSettings: {
    findUnique: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    resident: {
      findFirst: jest.fn(),
    },
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { credits: null } }),
    },
    collectionRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    paymentAllocation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { allocatedAmount: null } }),
    },
    condominiumSettings: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
}

const auditMock = { log: jest.fn().mockResolvedValue(undefined) };

function makeService(prisma: PrismaMock): CollectionService {
  return new CollectionService(prisma as never, auditMock as never);
}

function makeResident(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: RESIDENT_ID,
    unitNumber: 'A01',
    firstName: 'Carlos',
    lastName: 'Mendoza',
    debt: 0,
    monthlyFee: 2500,
    paymentStatus: 'CURRENT',
    ...overrides,
  };
}

describe('CollectionService — Phase 5 collection-query performance', () => {
  let prisma: PrismaMock;
  let service: CollectionService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = makeService(prisma);
  });

  describe('A2 — findByResident is paginated', () => {
    it('applies database-level skip/take with a 24-row default window', async () => {
      await service.findByResident(CONDOMINIUM_ID, RESIDENT_ID);

      const findArg = prisma.collectionRecord.findMany.mock.calls[0][0];
      expect(findArg.skip).toBe(0);
      expect(findArg.take).toBe(24);
      expect(findArg.orderBy).toEqual([{ year: 'desc' }, { month: 'desc' }]);
      expect(findArg.where).toEqual({
        condominiumId: CONDOMINIUM_ID,
        residentId: RESIDENT_ID,
      });
    });

    it('honors page/limit so older history stays reachable', async () => {
      await service.findByResident(CONDOMINIUM_ID, RESIDENT_ID, {
        page: 3,
        limit: 12,
      });

      const findArg = prisma.collectionRecord.findMany.mock.calls[0][0];
      expect(findArg.skip).toBe(24);
      expect(findArg.take).toBe(12);
    });

    it('returns { data, meta } with totalPages computed from the full count', async () => {
      prisma.collectionRecord.findMany.mockResolvedValue([{ id: 'cr-1' }]);
      prisma.collectionRecord.count.mockResolvedValue(50);

      const result = await service.findByResident(CONDOMINIUM_ID, RESIDENT_ID, {
        page: 2,
        limit: 24,
      });

      expect(result.data).toEqual([{ id: 'cr-1' }]);
      expect(result.meta).toEqual({
        total: 50,
        page: 2,
        limit: 24,
        totalPages: 3,
      });
    });

    it('counts with the same tenant-scoped where clause it queries with', async () => {
      await service.findByResident(CONDOMINIUM_ID, RESIDENT_ID);

      const findWhere = prisma.collectionRecord.findMany.mock.calls[0][0].where;
      const countWhere = prisma.collectionRecord.count.mock.calls[0][0].where;
      expect(countWhere).toEqual(findWhere);
      expect(countWhere.condominiumId).toBe(CONDOMINIUM_ID);
    });
  });

  describe('A3 — getAccountStatement aggregation & bounded records', () => {
    beforeEach(() => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
    });

    it('derives monthsPaid / monthsUnpaid / totalExpected from a DB groupBy', async () => {
      prisma.transaction.aggregate.mockResolvedValue({
        _sum: { credits: 7000 },
      });
      prisma.collectionRecord.groupBy.mockResolvedValue([
        {
          status: 'PAID_ON_TIME',
          _count: { _all: 5 },
          _sum: { amountExpected: 12500 },
        },
        {
          status: 'PAID_LATE',
          _count: { _all: 2 },
          _sum: { amountExpected: 5000 },
        },
        { status: 'UNPAID', _count: { _all: 3 }, _sum: { amountExpected: 7500 } },
        {
          status: 'PENDING',
          _count: { _all: 1 },
          _sum: { amountExpected: 2500 },
        },
      ]);

      const result = await service.getAccountStatement(
        CONDOMINIUM_ID,
        RESIDENT_ID,
      );

      // monthsPaid = PAID_ON_TIME(5) + PAID_LATE(2) = 7
      expect(result.summary.monthsPaid).toBe(7);
      // monthsUnpaid = UNPAID(3) + PENDING(1) = 4
      expect(result.summary.monthsUnpaid).toBe(4);
      // totalExpected = Σ amountExpected = 12500 + 5000 + 7500 + 2500 = 27500
      expect(result.summary.totalExpected).toBe(27500);
      expect(result.summary.totalPaid).toBe(7000);
      // balance = totalExpected − totalPaid (POSITIVE = owes) = 27500 − 7000
      expect(result.summary.balance).toBe(27500 - 7000);
      // compliancePercent = totalPaid / totalExpected · 100 = 7000 / 27500 · 100
      expect(result.summary.compliancePercent).toBeCloseTo((7000 / 27500) * 100);
    });

    it('returns null compliancePercent when nothing is expected yet (no history)', async () => {
      prisma.transaction.aggregate.mockResolvedValue({ _sum: { credits: 0 } });
      prisma.paymentAllocation.aggregate.mockResolvedValue({
        _sum: { allocatedAmount: 0 },
      });
      prisma.collectionRecord.groupBy.mockResolvedValue([]);

      const result = await service.getAccountStatement(CONDOMINIUM_ID, RESIDENT_ID);

      expect(result.summary.totalExpected).toBe(0);
      // Null (not 0%) so the web renders a dash instead of a misleading "0%".
      expect(result.summary.compliancePercent).toBeNull();
    });

    it('adds this resident\'s allocation shares to totalPaid without double-counting', async () => {
      // Direct income (own transactions, NOT split): $7000.
      prisma.transaction.aggregate.mockResolvedValue({ _sum: { credits: 7000 } });
      // Their slice of split payments ("casas 307 y 43"): $500.
      prisma.paymentAllocation.aggregate.mockResolvedValue({
        _sum: { allocatedAmount: 500 },
      });

      const result = await service.getAccountStatement(CONDOMINIUM_ID, RESIDENT_ID);

      // totalPaid = direct credits + allocation shares = 7000 + 500.
      expect(result.summary.totalPaid).toBe(7500);
      // The direct income bucket must EXCLUDE transactions that were split into
      // allocations, so their amount is never counted twice.
      expect(prisma.transaction.aggregate.mock.calls[0][0].where).toMatchObject({
        flowType: 'INCOME',
        paymentAllocations: { none: {} },
      });
    });

    it('excludes PARTIAL / ADJUSTMENT / EXTRAORDINARY / AGREEMENT from both month counts (status semantics preserved)', async () => {
      prisma.collectionRecord.groupBy.mockResolvedValue([
        {
          status: 'PAID_ON_TIME',
          _count: { _all: 4 },
          _sum: { amountExpected: 10000 },
        },
        {
          status: 'PARTIAL',
          _count: { _all: 2 },
          _sum: { amountExpected: 5000 },
        },
        {
          status: 'ADJUSTMENT',
          _count: { _all: 1 },
          _sum: { amountExpected: 2500 },
        },
        {
          status: 'EXTRAORDINARY',
          _count: { _all: 1 },
          _sum: { amountExpected: 2500 },
        },
        {
          status: 'AGREEMENT',
          _count: { _all: 1 },
          _sum: { amountExpected: 2500 },
        },
      ]);

      const result = await service.getAccountStatement(
        CONDOMINIUM_ID,
        RESIDENT_ID,
      );

      expect(result.summary.monthsPaid).toBe(4);
      expect(result.summary.monthsUnpaid).toBe(0);
      // totalExpected still sums EVERY group (matches prior reduce over all records)
      expect(result.summary.totalExpected).toBe(22500);
    });

    it('bounds the returned collectionRecords list with a 24-row default window', async () => {
      await service.getAccountStatement(CONDOMINIUM_ID, RESIDENT_ID);

      const findArg = prisma.collectionRecord.findMany.mock.calls[0][0];
      expect(findArg.skip).toBe(0);
      expect(findArg.take).toBe(24);
      expect(findArg.orderBy).toEqual([{ year: 'desc' }, { month: 'desc' }]);
    });

    it('honors crPage / crLimit on the records list without affecting the summary query', async () => {
      prisma.collectionRecord.groupBy.mockResolvedValue([
        {
          status: 'PAID_ON_TIME',
          _count: { _all: 36 },
          _sum: { amountExpected: 90000 },
        },
      ]);

      const result = await service.getAccountStatement(
        CONDOMINIUM_ID,
        RESIDENT_ID,
        { crPage: 2, crLimit: 12 },
      );

      const findArg = prisma.collectionRecord.findMany.mock.calls[0][0];
      expect(findArg.skip).toBe(12);
      expect(findArg.take).toBe(12);

      // groupBy runs over the FULL filtered set — no skip/take — so the summary
      // reflects all 36 months even though the list page shows at most 12.
      const groupArg = prisma.collectionRecord.groupBy.mock.calls[0][0];
      expect(groupArg).not.toHaveProperty('skip');
      expect(groupArg).not.toHaveProperty('take');
      expect(result.summary.monthsPaid).toBe(36);
    });

    it('scopes both the records and the groupBy to the tenant + resident, with year/month filters applied', async () => {
      await service.getAccountStatement(CONDOMINIUM_ID, RESIDENT_ID, {
        year: 2025,
        month: 6,
      });

      const findWhere = prisma.collectionRecord.findMany.mock.calls[0][0].where;
      const groupWhere = prisma.collectionRecord.groupBy.mock.calls[0][0].where;
      expect(findWhere).toEqual({
        condominiumId: CONDOMINIUM_ID,
        residentId: RESIDENT_ID,
        year: 2025,
        month: 6,
      });
      // The summary must aggregate exactly the same filtered set as the list.
      expect(groupWhere).toEqual(findWhere);
    });

    it('throws NotFoundException for a resident outside the tenant', async () => {
      prisma.resident.findFirst.mockResolvedValue(null);

      await expect(
        service.getAccountStatement(CONDOMINIUM_ID, 'ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.collectionRecord.groupBy).not.toHaveBeenCalled();
    });

    it('treats a missing income aggregate as zero paid', async () => {
      prisma.transaction.aggregate.mockResolvedValue({ _sum: { credits: null } });
      prisma.collectionRecord.groupBy.mockResolvedValue([]);

      const result = await service.getAccountStatement(
        CONDOMINIUM_ID,
        RESIDENT_ID,
      );

      expect(result.summary.totalPaid).toBe(0);
      expect(result.summary.totalExpected).toBe(0);
      expect(result.summary.monthsPaid).toBe(0);
      expect(result.summary.monthsUnpaid).toBe(0);
      expect(result.summary.balance).toBe(0);
    });
  });

  describe('Fase 3 — getFinancialHealth', () => {
    beforeEach(() => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
    });

    it('returns the current 7-factor score (debt-positive balance flows in) + a derived history', async () => {
      // Two unpaid months, $1000 expected each, $0 paid → balance +2000 (owes).
      prisma.transaction.aggregate.mockResolvedValue({ _sum: { credits: 0 } });
      prisma.collectionRecord.groupBy.mockResolvedValue([
        { status: 'UNPAID', _count: { _all: 2 }, _sum: { amountExpected: 2000 } },
      ]);
      prisma.collectionRecord.findMany.mockResolvedValue([
        { year: 2026, month: 1, status: 'UNPAID', amountPaid: 0, amountExpected: 1000 },
        { year: 2026, month: 2, status: 'UNPAID', amountPaid: 0, amountExpected: 1000 },
      ]);

      const result = await service.getFinancialHealth(CONDOMINIUM_ID, RESIDENT_ID, 12);

      expect(result.current.factors).toHaveLength(7);
      const balance = result.current.factors.find((f) => f.key === 'balance')!;
      expect(balance.rawValue).toBe(2000); // positive = debt reaches the scorer
      expect(typeof result.current.computedAt).toBe('string');
      expect(Array.isArray(result.history)).toBe(true);
      expect(result.history.length).toBeGreaterThan(0);
      expect(result.history[0]).toEqual(
        expect.objectContaining({ year: expect.any(Number), month: expect.any(Number), score: expect.any(Number) }),
      );
    });

    it('pulls the full collection history (large crLimit) and is tenant-scoped', async () => {
      prisma.collectionRecord.groupBy.mockResolvedValue([]);
      await service.getFinancialHealth(CONDOMINIUM_ID, RESIDENT_ID);
      const findArg = prisma.collectionRecord.findMany.mock.calls[0][0];
      expect(findArg.take).toBeGreaterThan(24); // not the bounded 24-row window
      expect(findArg.where).toMatchObject({ condominiumId: CONDOMINIUM_ID, residentId: RESIDENT_ID });
    });

    it('Fase 4 — applies the condominium score weights (null → defaults)', async () => {
      prisma.collectionRecord.groupBy.mockResolvedValue([]);
      prisma.collectionRecord.findMany.mockResolvedValue([
        { year: 2026, month: 1, status: 'PAID_ON_TIME', amountPaid: 1000, amountExpected: 1000 },
      ]);
      // Custom weights: all on punctuality → onTime weight 100, others 0.
      prisma.condominiumSettings.findUnique.mockResolvedValue({
        financialHealthWeights: {
          onTime: 100, collectionRate: 0, monthsCurrent: 0, delinquencyAge: 0,
          balance: 0, recurrence: 0, trend: 0,
        },
      });
      const custom = await service.getFinancialHealth(CONDOMINIUM_ID, RESIDENT_ID);
      expect(custom.current.factors.find((f) => f.key === 'onTime')!.weight).toBe(100);
      expect(custom.current.factors.find((f) => f.key === 'balance')!.weight).toBe(0);
      expect(prisma.condominiumSettings.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { condominiumId: CONDOMINIUM_ID } }),
      );

      // null settings → documented defaults (onTime weight 22).
      prisma.condominiumSettings.findUnique.mockResolvedValue(null);
      const def = await service.getFinancialHealth(CONDOMINIUM_ID, RESIDENT_ID);
      expect(def.current.factors.find((f) => f.key === 'onTime')!.weight).toBe(22);
    });

    it('throws NotFound for a resident outside the tenant', async () => {
      prisma.resident.findFirst.mockResolvedValue(null);
      await expect(
        service.getFinancialHealth(CONDOMINIUM_ID, 'ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
