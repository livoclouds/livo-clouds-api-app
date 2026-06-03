import { NotFoundException } from '@nestjs/common';
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
  };
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
    },
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
});
