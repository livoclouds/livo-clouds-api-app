import { BadRequestException, NotFoundException } from '@nestjs/common';

import { QuotationsService } from './quotations.service';

const CONDOMINIUM_ID = 'cond-1';
const USER_ID = 'user-1';

interface PrismaMock {
  quotationRequest: {
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  quotation: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    quotationRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    quotation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };
  // Callback form of $transaction runs against the same mock client.
  mock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: PrismaMock) => Promise<unknown>)(mock)
      : undefined,
  );
  return mock;
}

function makeAuditMock() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeService(prisma: PrismaMock) {
  return new QuotationsService(
    prisma as never,
    makeAuditMock() as never,
  );
}

// A Prisma-row-shaped request (Date objects + Decimal-ish amounts) the shaping
// helpers expect.
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    title: 'Paint',
    description: '',
    category: 'painting',
    status: 'received',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    targetStartDate: null,
    targetEndDate: null,
    selectedQuotationId: null,
    beforePhotos: [],
    afterPhotos: [],
    comments: '',
    quotations: [],
    ...over,
  };
}

function quote(over: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    requestId: 'req-1',
    providerName: 'A',
    providerPhone: null,
    providerEmail: null,
    amount: 5000,
    currency: 'MXN',
    quoteDate: new Date('2026-06-01T00:00:00Z'),
    estimatedStartDate: null,
    estimatedEndDate: null,
    documentUrl: null,
    notes: '',
    ...over,
  };
}

describe('QuotationsService', () => {
  describe('findAll', () => {
    it('scopes the query to the tenant and excludes soft-deleted rows', async () => {
      const prisma = makePrismaMock();
      prisma.quotationRequest.findMany.mockResolvedValue([]);
      prisma.quotationRequest.count.mockResolvedValue(0);
      const service = makeService(prisma);

      const result = await service.findAll(CONDOMINIUM_ID, {
        page: 1,
        limit: 50,
      });

      const where = prisma.quotationRequest.findMany.mock.calls[0][0].where;
      expect(where.condominiumId).toBe(CONDOMINIUM_ID);
      expect(where.deletedAt).toBeNull();
      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 1,
      });
    });

    it('derives count, lowest amount, and selected quotation per request', async () => {
      const prisma = makePrismaMock();
      prisma.quotationRequest.findMany.mockResolvedValue([
        row({
          selectedQuotationId: 'q-2',
          quotations: [quote({ id: 'q-1', amount: 5000 }), quote({ id: 'q-2', amount: 4200 })],
        }),
      ]);
      prisma.quotationRequest.count.mockResolvedValue(1);
      const service = makeService(prisma);

      const { data } = await service.findAll(CONDOMINIUM_ID, {});
      expect(data[0].quotationsCount).toBe(2);
      expect(data[0].lowestAmount).toBe(4200);
      expect(data[0].selectedQuotation?.id).toBe('q-2');
      expect(data[0]).not.toHaveProperty('quotations');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the request is absent in the tenant', async () => {
      const prisma = makePrismaMock();
      prisma.quotationRequest.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      await expect(service.findOne(CONDOMINIUM_ID, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('rejects a selectedQuotationId that is not one of the request quotations', async () => {
      const prisma = makePrismaMock();
      prisma.quotationRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: 'received',
        quotations: [{ id: 'q-1' }],
      });
      const service = makeService(prisma);

      await expect(
        service.update(CONDOMINIUM_ID, USER_ID, 'req-1', {
          selectedQuotationId: 'q-foreign',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.quotationRequest.update).not.toHaveBeenCalled();
    });

    it('accepts a valid selection and persists it', async () => {
      const prisma = makePrismaMock();
      prisma.quotationRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: 'received',
        quotations: [{ id: 'q-1' }],
      });
      prisma.quotationRequest.update.mockResolvedValue(
        row({ selectedQuotationId: 'q-1', status: 'providerSelected', quotations: [quote()] }),
      );
      const service = makeService(prisma);

      const result = await service.update(CONDOMINIUM_ID, USER_ID, 'req-1', {
        selectedQuotationId: 'q-1',
        status: 'providerSelected',
      });
      expect(result.selectedQuotationId).toBe('q-1');
      expect(prisma.quotationRequest.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('soft-deletes by stamping deletedAt and scopes by tenant', async () => {
      const prisma = makePrismaMock();
      prisma.quotationRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        title: 'Paint',
        status: 'received',
      });
      const service = makeService(prisma);

      const result = await service.remove(CONDOMINIUM_ID, USER_ID, 'req-1');

      expect(result).toEqual({ ok: true });
      const findWhere = prisma.quotationRequest.findFirst.mock.calls[0][0].where;
      expect(findWhere.condominiumId).toBe(CONDOMINIUM_ID);
      expect(findWhere.deletedAt).toBeNull();
      const updateArg = prisma.quotationRequest.update.mock.calls[0][0];
      expect(updateArg.data.deletedAt).toBeInstanceOf(Date);
    });
  });
});
