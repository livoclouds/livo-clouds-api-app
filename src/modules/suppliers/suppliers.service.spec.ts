import { ConflictException, NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

const CONDOMINIUM_ID = 'cond-1';
const USER_ID = 'user-1';

interface PrismaMock {
  supplier: {
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
  supplierRating: {
    groupBy: jest.Mock;
    aggregate: jest.Mock;
    create: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  reconciliationRule: { updateMany: jest.Mock };
  transaction: { count: jest.Mock };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    supplier: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'sup-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({ id: 'sup-1' }),
    },
    supplierRating: {
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _avg: { score: null }, _count: { _all: 0 } }),
      create: jest.fn().mockResolvedValue({ id: 'rat-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    reconciliationRule: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    transaction: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaMock) => Promise<unknown>)(mock);
    }
    return undefined;
  });
  return mock;
}

function makeAuditMock() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeService(prisma: PrismaMock, audit: ReturnType<typeof makeAuditMock>) {
  return new SuppliersService(prisma as never, audit as never);
}

describe('SuppliersService', () => {
  describe('findAll', () => {
    it('scopes the query to the tenant and excludes soft-deleted rows', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }]);
      prisma.supplier.count.mockResolvedValue(1);
      const service = makeService(prisma, makeAuditMock());

      const result = await service.findAll(CONDOMINIUM_ID, { page: 1, limit: 50 });

      const where = prisma.supplier.findMany.mock.calls[0][0].where;
      expect(where.condominiumId).toBe(CONDOMINIUM_ID);
      expect(where.deletedAt).toBeNull();
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 50, totalPages: 1 });
    });

    it('applies search/type/status filters when provided', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeAuditMock());

      await service.findAll(CONDOMINIUM_ID, {
        search: 'vidal',
        type: undefined,
        status: undefined,
      } as never);

      const where = prisma.supplier.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { supplierName: { contains: 'vidal', mode: 'insensitive' } },
      ]);
    });
  });

  describe('findOne', () => {
    it('throws NotFound when the supplier is absent or out of tenant', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeAuditMock());
      await expect(service.findOne(CONDOMINIUM_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('forces tenant/actor fields and never trusts the body, and audits', async () => {
      const prisma = makePrismaMock();
      const audit = makeAuditMock();
      prisma.supplier.create.mockResolvedValue({ id: 'sup-9' });
      const service = makeService(prisma, audit);

      await service.create(CONDOMINIUM_ID, USER_ID, {
        supplierName: 'ACME',
        type: 'CLEANING',
      } as never);

      const data = prisma.supplier.create.mock.calls[0][0].data;
      expect(data.condominiumId).toBe(CONDOMINIUM_ID);
      expect(data.createdBy).toBe(USER_ID);
      expect(data.updatedBy).toBe(USER_ID);
      expect(audit.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('throws NotFound when the row is not in the tenant', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst.mockResolvedValue(null);
      const service = makeService(prisma, makeAuditMock());
      await expect(
        service.update(CONDOMINIUM_ID, USER_ID, 'x', { supplierName: 'y' } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates with a structural tenant filter and sets updatedBy', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst
        .mockResolvedValueOnce({ id: 'sup-1', supplierName: 'old' })
        .mockResolvedValueOnce({ id: 'sup-1', supplierName: 'new' });
      const service = makeService(prisma, makeAuditMock());

      await service.update(CONDOMINIUM_ID, USER_ID, 'sup-1', {
        supplierName: 'new',
      } as never);

      const call = prisma.supplier.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: 'sup-1',
        condominiumId: CONDOMINIUM_ID,
        deletedAt: null,
      });
      expect(call.data.updatedBy).toBe(USER_ID);
    });
  });

  describe('remove', () => {
    it('soft-deletes (sets deletedAt) instead of hard delete', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      const service = makeService(prisma, makeAuditMock());

      await service.remove(CONDOMINIUM_ID, USER_ID, 'sup-1');

      const call = prisma.supplier.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: 'sup-1',
        condominiumId: CONDOMINIUM_ID,
        deletedAt: null,
      });
      expect(call.data.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('findAll aggregates', () => {
    it('attaches rounded averageRating + ratingCount from the rating history', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findMany.mockResolvedValue([
        { id: 'sup-1' },
        { id: 'sup-2' },
      ]);
      prisma.supplier.count.mockResolvedValue(2);
      prisma.supplierRating.groupBy.mockResolvedValue([
        { supplierId: 'sup-1', _avg: { score: 4.666 }, _count: { _all: 3 } },
      ]);
      const service = makeService(prisma, makeAuditMock());

      const result = await service.findAll(CONDOMINIUM_ID, {});
      const rows = result.data as Array<{
        id: string;
        averageRating: number;
        ratingCount: number;
        jobsCount: number;
      }>;

      expect(rows[0]).toMatchObject({
        id: 'sup-1',
        averageRating: 4.7,
        ratingCount: 3,
        jobsCount: 0,
      });
      // A supplier with no ratings reports zeros, not NaN/undefined.
      expect(rows[1]).toMatchObject({ averageRating: 0, ratingCount: 0 });
    });

    it('returns archived rows when `archived` is set', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeAuditMock());

      await service.findAll(CONDOMINIUM_ID, { archived: true } as never);

      const where = prisma.supplier.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toEqual({ not: null });
    });

    it('filters by category and engagementType', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeAuditMock());

      await service.findAll(CONDOMINIUM_ID, {
        category: 'GARDENING',
        engagementType: 'FIXED',
      } as never);

      const where = prisma.supplier.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { category: 'GARDENING' },
        { engagementType: 'FIXED' },
      ]);
    });
  });

  describe('restore', () => {
    it('throws NotFound when no archived row matches', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst.mockResolvedValue(null);
      const service = makeService(prisma, makeAuditMock());
      await expect(
        service.restore(CONDOMINIUM_ID, USER_ID, 'x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('clears deletedAt with a structural archived filter', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst
        .mockResolvedValueOnce({ id: 'sup-1', deletedAt: new Date() })
        .mockResolvedValueOnce({ id: 'sup-1', deletedAt: null });
      const service = makeService(prisma, makeAuditMock());

      await service.restore(CONDOMINIUM_ID, USER_ID, 'sup-1');

      const call = prisma.supplier.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: 'sup-1',
        condominiumId: CONDOMINIUM_ID,
        deletedAt: { not: null },
      });
      expect(call.data.deletedAt).toBeNull();
      expect(call.data.updatedBy).toBe(USER_ID);
    });
  });

  describe('addRating', () => {
    it('throws NotFound when the supplier is out of tenant', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst.mockResolvedValue(null);
      const service = makeService(prisma, makeAuditMock());
      await expect(
        service.addRating(CONDOMINIUM_ID, USER_ID, 'x', { score: 5 } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('appends a rating with the actor id and returns refreshed aggregates', async () => {
      const prisma = makePrismaMock();
      const audit = makeAuditMock();
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prisma.supplierRating.create.mockResolvedValue({ id: 'rat-9' });
      prisma.supplierRating.aggregate.mockResolvedValue({
        _avg: { score: 4.5 },
        _count: { _all: 2 },
      });
      const service = makeService(prisma, audit);

      const out = await service.addRating(CONDOMINIUM_ID, USER_ID, 'sup-1', {
        score: 4,
        comment: 'ok',
      } as never);

      const data = prisma.supplierRating.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        condominiumId: CONDOMINIUM_ID,
        supplierId: 'sup-1',
        score: 4,
        createdBy: USER_ID,
      });
      expect(out).toEqual({
        rating: { id: 'rat-9' },
        averageRating: 4.5,
        ratingCount: 2,
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('listRatings', () => {
    it('throws NotFound when the supplier is absent', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst.mockResolvedValue(null);
      const service = makeService(prisma, makeAuditMock());
      await expect(
        service.listRatings(CONDOMINIUM_ID, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the tenant-scoped history newest first', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prisma.supplierRating.findMany.mockResolvedValue([{ id: 'rat-1' }]);
      const service = makeService(prisma, makeAuditMock());

      const rows = await service.listRatings(CONDOMINIUM_ID, 'sup-1');

      const call = prisma.supplierRating.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        condominiumId: CONDOMINIUM_ID,
        supplierId: 'sup-1',
      });
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(rows).toEqual([{ id: 'rat-1' }]);
    });
  });

  describe('hardDelete', () => {
    it('throws NotFound when the supplier is absent', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst.mockResolvedValue(null);
      const service = makeService(prisma, makeAuditMock());
      await expect(
        service.hardDelete(CONDOMINIUM_ID, USER_ID, 'x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses (409) when the supplier has transactions, without deleting', async () => {
      const prisma = makePrismaMock();
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prisma.transaction.count.mockResolvedValue(3);
      const service = makeService(prisma, makeAuditMock());

      await expect(
        service.hardDelete(CONDOMINIUM_ID, USER_ID, 'sup-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.supplier.delete).not.toHaveBeenCalled();
    });

    it('unlinks rules, cascades ratings, deletes and audits when unused', async () => {
      const prisma = makePrismaMock();
      const audit = makeAuditMock();
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
      prisma.transaction.count.mockResolvedValue(0);
      const service = makeService(prisma, audit);

      await service.hardDelete(CONDOMINIUM_ID, USER_ID, 'sup-1');

      expect(prisma.reconciliationRule.updateMany).toHaveBeenCalledWith({
        where: { condominiumId: CONDOMINIUM_ID, supplierId: 'sup-1' },
        data: { supplierId: null },
      });
      expect(prisma.supplierRating.deleteMany).toHaveBeenCalledWith({
        where: { condominiumId: CONDOMINIUM_ID, supplierId: 'sup-1' },
      });
      expect(prisma.supplier.delete).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
    });
  });
});
