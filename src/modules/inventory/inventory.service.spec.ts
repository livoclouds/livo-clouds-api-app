import { ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import {
  CommonAreaStatusDto,
  CreateCommonAreaDto,
} from './dto/create-common-area.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';
import {
  CreateInventoryItemDto,
  InventoryCategoryDto,
} from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';

const CONDOMINIUM_ID = 'cond-1';
const OTHER_CONDOMINIUM_ID = 'cond-evil';
const USER_ID = 'user-42';
const AREA_ID = 'area-1';
const ITEM_ID = 'item-1';

interface PrismaMock {
  commonArea: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  inventoryItem: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface AuditMock {
  log: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock = {
    commonArea: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryItem: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as Omit<PrismaMock, '$transaction'>;

  // Run the interactive-transaction callback with the mock itself as the tx
  // client, so the callback's reads/writes resolve and a thrown error rejects
  // the whole $transaction — the unit-level proxy for atomic rollback.
  const $transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(mock));

  return Object.assign(mock, { $transaction });
}

function makeAuditMock(): AuditMock {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeService(prisma: PrismaMock, audit: AuditMock): InventoryService {
  return new InventoryService(prisma as never, audit as never);
}

function makeArea(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: AREA_ID,
    condominiumId: CONDOMINIUM_ID,
    name: 'Rooftop Terrace',
    nameKey: null,
    description: null,
    physicalLocation: null,
    status: 'ACTIVE',
    responsiblePerson: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
    inventoryItems: [],
    ...overrides,
  };
}

function makeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ITEM_ID,
    condominiumId: CONDOMINIUM_ID,
    commonAreaId: AREA_ID,
    name: 'Coffee Machine',
    category: 'APPLIANCES',
    brand: null,
    model: null,
    serialNumber: null,
    quantity: 1,
    condition: 'GOOD',
    purchaseDate: null,
    approximateCost: null,
    supplier: null,
    hasInvoice: false,
    invoiceNumber: null,
    notes: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
    commonArea: { id: AREA_ID, name: 'Rooftop Terrace' },
    ...overrides,
  };
}

describe('InventoryService — Common Areas (Phase 1 safety net)', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: InventoryService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = makeService(prisma, audit);
  });

  describe('createArea', () => {
    it('writes exactly one COMMON_AREA_CREATED audit event with afterState', async () => {
      const created = makeArea();
      prisma.commonArea.create.mockResolvedValue(created);

      const dto: CreateCommonAreaDto = { name: 'Rooftop Terrace' };
      const result = await service.createArea(CONDOMINIUM_ID, USER_ID, dto);

      expect(result).toBe(created);
      expect(prisma.commonArea.create).toHaveBeenCalledTimes(1);
      expect(prisma.commonArea.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Rooftop Terrace',
          condominiumId: CONDOMINIUM_ID,
        }),
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMMON_AREA_CREATED',
          actionCategory: 'CREATE',
          module: 'inventory',
          entityType: 'CommonArea',
          entityId: created.id,
          afterState: created,
        }),
        prisma,
      );
    });
  });

  describe('updateArea', () => {
    it('writes one COMMON_AREA_UPDATED audit event with before and after state', async () => {
      const before = makeArea({ status: 'ACTIVE' });
      const after = makeArea({ status: 'MAINTENANCE' });
      prisma.commonArea.findFirst
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after);

      const dto: UpdateCommonAreaDto = { status: CommonAreaStatusDto.MAINTENANCE };
      const result = await service.updateArea(
        CONDOMINIUM_ID,
        USER_ID,
        AREA_ID,
        dto,
      );

      expect(result).toBe(after);
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMMON_AREA_UPDATED',
          actionCategory: 'UPDATE',
          module: 'inventory',
          entityId: AREA_ID,
          beforeState: before,
          afterState: after,
        }),
        prisma,
      );
    });

    it('throws NotFoundException when the area is absent for the tenant', async () => {
      prisma.commonArea.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.updateArea(CONDOMINIUM_ID, USER_ID, AREA_ID, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.commonArea.updateMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    // CMA-003 regression: a PATCH body carrying condominiumId must not be able
    // to reassign the area to another tenant.
    it('ignores condominiumId in the body and keeps the session tenant scope', async () => {
      prisma.commonArea.findFirst
        .mockResolvedValueOnce(makeArea())
        .mockResolvedValueOnce(makeArea({ name: 'Renamed' }));

      const maliciousBody = {
        name: 'Renamed',
        condominiumId: OTHER_CONDOMINIUM_ID,
      } as unknown as UpdateCommonAreaDto;

      await service.updateArea(CONDOMINIUM_ID, USER_ID, AREA_ID, maliciousBody);

      expect(prisma.commonArea.updateMany).toHaveBeenCalledTimes(1);
      const call = prisma.commonArea.updateMany.mock.calls[0][0];
      // The write is filtered by the session tenant, not the body.
      expect(call.where).toEqual({ id: AREA_ID, condominiumId: CONDOMINIUM_ID });
      // The allow-listed payload never carries condominiumId.
      expect(call.data).not.toHaveProperty('condominiumId');
      expect(call.data.name).toBe('Renamed');
    });

    // CMA-004 atomicity: a failed audit write must abort the data mutation.
    it('rejects (rolls back) when the audit write fails', async () => {
      prisma.commonArea.findFirst
        .mockResolvedValueOnce(makeArea())
        .mockResolvedValueOnce(makeArea());
      audit.log.mockRejectedValueOnce(new Error('audit sink down'));

      await expect(
        service.updateArea(CONDOMINIUM_ID, USER_ID, AREA_ID, { name: 'X' }),
      ).rejects.toThrow('audit sink down');
      // Both the mutation and the audit write share one $transaction callback,
      // so the rejection unwinds the whole unit of work.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeArea', () => {
    it('deletes an empty area and writes one COMMON_AREA_DELETED audit event', async () => {
      const before = makeArea();
      prisma.commonArea.findFirst.mockResolvedValueOnce(before);
      prisma.inventoryItem.count.mockResolvedValueOnce(0);

      const result = await service.removeArea(CONDOMINIUM_ID, USER_ID, AREA_ID);

      expect(result).toBe(before);
      expect(prisma.commonArea.deleteMany).toHaveBeenCalledWith({
        where: { id: AREA_ID, condominiumId: CONDOMINIUM_ID },
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMMON_AREA_DELETED',
          actionCategory: 'DELETE',
          module: 'inventory',
          entityId: AREA_ID,
          beforeState: before,
          afterState: null,
        }),
        prisma,
      );
    });

    // CMA-005: deleting a populated area must fail with a clean 409, and must
    // not delete the area or its items.
    it('throws ConflictException for a populated area and deletes nothing', async () => {
      prisma.commonArea.findFirst.mockResolvedValueOnce(makeArea());
      prisma.inventoryItem.count.mockResolvedValueOnce(3);

      await expect(
        service.removeArea(CONDOMINIUM_ID, USER_ID, AREA_ID),
      ).rejects.toThrow(ConflictException);
      expect(prisma.commonArea.deleteMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the area is absent for the tenant', async () => {
      prisma.commonArea.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.removeArea(CONDOMINIUM_ID, USER_ID, AREA_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.inventoryItem.count).not.toHaveBeenCalled();
      expect(prisma.commonArea.deleteMany).not.toHaveBeenCalled();
    });
  });
});

describe('InventoryService — Common Areas (Phase 2 audit-trail contract)', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: InventoryService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = makeService(prisma, audit);
  });

  describe('createArea', () => {
    it('persists createdBy and updatedBy from the acting user', async () => {
      prisma.commonArea.create.mockResolvedValue(
        makeArea({ createdBy: USER_ID, updatedBy: USER_ID }),
      );

      await service.createArea(CONDOMINIUM_ID, USER_ID, {
        name: 'Rooftop Terrace',
      });

      expect(prisma.commonArea.create).toHaveBeenCalledTimes(1);
      const data = prisma.commonArea.create.mock.calls[0][0].data;
      // On create both actor fields record the creator.
      expect(data.createdBy).toBe(USER_ID);
      expect(data.updatedBy).toBe(USER_ID);
    });

    // CMA-006 / CMA-003: createdBy / updatedBy are API-owned. A create body
    // carrying them must never reach Prisma — the allow-listed mapper drops
    // them and the session user is the only source.
    it('ignores createdBy / updatedBy supplied in the create body', async () => {
      prisma.commonArea.create.mockResolvedValue(makeArea());

      const maliciousBody = {
        name: 'Rooftop Terrace',
        createdBy: 'attacker-user',
        updatedBy: 'attacker-user',
      } as unknown as CreateCommonAreaDto;

      await service.createArea(CONDOMINIUM_ID, USER_ID, maliciousBody);

      const data = prisma.commonArea.create.mock.calls[0][0].data;
      expect(data.createdBy).toBe(USER_ID);
      expect(data.updatedBy).toBe(USER_ID);
    });
  });

  describe('updateArea', () => {
    it('persists updatedBy from the acting user and never writes createdBy', async () => {
      prisma.commonArea.findFirst
        .mockResolvedValueOnce(makeArea())
        .mockResolvedValueOnce(
          makeArea({ name: 'Renamed', updatedBy: USER_ID }),
        );

      await service.updateArea(CONDOMINIUM_ID, USER_ID, AREA_ID, {
        name: 'Renamed',
      });

      expect(prisma.commonArea.updateMany).toHaveBeenCalledTimes(1);
      const data = prisma.commonArea.updateMany.mock.calls[0][0].data;
      expect(data.updatedBy).toBe(USER_ID);
      // createdBy is immutable after creation — an update must not touch it.
      expect(data).not.toHaveProperty('createdBy');
    });

    // CMA-006 / CMA-003: a PATCH body carrying createdBy / updatedBy must not
    // override the session-derived actor.
    it('ignores createdBy / updatedBy supplied in the update body', async () => {
      prisma.commonArea.findFirst
        .mockResolvedValueOnce(makeArea())
        .mockResolvedValueOnce(makeArea({ name: 'Renamed' }));

      const maliciousBody = {
        name: 'Renamed',
        createdBy: 'attacker-user',
        updatedBy: 'attacker-user',
      } as unknown as UpdateCommonAreaDto;

      await service.updateArea(CONDOMINIUM_ID, USER_ID, AREA_ID, maliciousBody);

      const data = prisma.commonArea.updateMany.mock.calls[0][0].data;
      expect(data.updatedBy).toBe(USER_ID);
      expect(data).not.toHaveProperty('createdBy');
    });
  });

  describe('findAllAreas', () => {
    it('returns rows carrying all four audit fields in the data/meta envelope', async () => {
      const area = makeArea({ createdBy: USER_ID, updatedBy: USER_ID });
      prisma.commonArea.findMany.mockResolvedValueOnce([area]);
      prisma.commonArea.count.mockResolvedValueOnce(1);

      const result = await service.findAllAreas(CONDOMINIUM_ID);

      expect(result.meta).toEqual(
        expect.objectContaining({ total: 1, page: 1 }),
      );
      const row = result.data[0] as Record<string, unknown>;
      // The list contract exposes createdAt, updatedAt, createdBy, updatedBy.
      expect(row).toHaveProperty('createdAt');
      expect(row).toHaveProperty('updatedAt');
      expect(row.createdBy).toBe(USER_ID);
      expect(row.updatedBy).toBe(USER_ID);
    });
  });
});

describe('InventoryService — Common Areas (Phase 5 — server-side filter / sort)', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: InventoryService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = makeService(prisma, audit);
  });

  describe('findAllAreas — where', () => {
    // CMA-013: tenant scope is always present and never derived from request
    // input; filters are added on top of the condominiumId scope.
    it('always scopes by condominiumId and applies name / status / responsible filters', async () => {
      await service.findAllAreas(CONDOMINIUM_ID, {
        name: 'pool',
        status: CommonAreaStatusDto.MAINTENANCE,
        responsible: 'ana',
      });

      const findArgs = prisma.commonArea.findMany.mock.calls[0][0];
      expect(findArgs.where.condominiumId).toBe(CONDOMINIUM_ID);
      expect(findArgs.where.AND).toEqual(
        expect.arrayContaining([
          { name: { contains: 'pool', mode: 'insensitive' } },
          { responsiblePerson: { contains: 'ana', mode: 'insensitive' } },
          { status: 'MAINTENANCE' },
        ]),
      );
      // count() is scoped by exactly the same where, so meta.total is filtered.
      const countArgs = prisma.commonArea.count.mock.calls[0][0];
      expect(countArgs.where).toEqual(findArgs.where);
    });

    it('omits the AND clause when no filters are supplied', async () => {
      await service.findAllAreas(CONDOMINIUM_ID, {});

      const findArgs = prisma.commonArea.findMany.mock.calls[0][0];
      expect(findArgs.where).toEqual({ condominiumId: CONDOMINIUM_ID });
    });
  });

  describe('findAllAreas — orderBy', () => {
    // CMA-013: stable sort — the selected column followed by an `id` tiebreaker.
    it('applies the allow-listed sort column with a stable id tiebreaker', async () => {
      await service.findAllAreas(CONDOMINIUM_ID, {
        sortBy: 'status',
        sortDirection: 'desc',
      });

      const findArgs = prisma.commonArea.findMany.mock.calls[0][0];
      expect(findArgs.orderBy).toEqual([{ status: 'desc' }, { id: 'asc' }]);
    });

    it('defaults to name ascending with the id tiebreaker', async () => {
      await service.findAllAreas(CONDOMINIUM_ID, {});

      const findArgs = prisma.commonArea.findMany.mock.calls[0][0];
      expect(findArgs.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    });

    it('maps responsiblePerson and the audit columns to their Prisma fields', async () => {
      await service.findAllAreas(CONDOMINIUM_ID, { sortBy: 'responsiblePerson' });
      expect(prisma.commonArea.findMany.mock.calls[0][0].orderBy).toEqual([
        { responsiblePerson: 'asc' },
        { id: 'asc' },
      ]);

      prisma.commonArea.findMany.mockClear();
      await service.findAllAreas(CONDOMINIUM_ID, { sortBy: 'updatedAt' });
      expect(prisma.commonArea.findMany.mock.calls[0][0].orderBy).toEqual([
        { updatedAt: 'asc' },
        { id: 'asc' },
      ]);
    });
  });

  describe('findAllAreas — pagination', () => {
    it('derives skip / take from page and limit and returns a filtered meta', async () => {
      prisma.commonArea.findMany.mockResolvedValueOnce([makeArea()]);
      prisma.commonArea.count.mockResolvedValueOnce(51);

      const result = await service.findAllAreas(CONDOMINIUM_ID, {
        page: 3,
        limit: 25,
      });

      const findArgs = prisma.commonArea.findMany.mock.calls[0][0];
      expect(findArgs.skip).toBe(50);
      expect(findArgs.take).toBe(25);
      expect(result.meta).toEqual({
        total: 51,
        page: 3,
        limit: 25,
        totalPages: 3,
      });
    });
  });
});

describe('InventoryService — Inventory Items (Phase 2 audit-trail contract)', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: InventoryService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = makeService(prisma, audit);
  });

  describe('createItem', () => {
    it('persists createdBy from the acting user', async () => {
      // findAreaOrFail resolves so the create proceeds.
      prisma.commonArea.findFirst.mockResolvedValue(makeArea());
      prisma.inventoryItem.create.mockResolvedValue(
        makeItem({ createdBy: USER_ID }),
      );

      const dto: CreateInventoryItemDto = {
        name: 'Coffee Machine',
        category: InventoryCategoryDto.APPLIANCES,
        commonAreaId: AREA_ID,
      };
      await service.createItem(CONDOMINIUM_ID, USER_ID, dto);

      expect(prisma.inventoryItem.create).toHaveBeenCalledTimes(1);
      const data = prisma.inventoryItem.create.mock.calls[0][0].data;
      // INV-005: the create payload stamps the session user as the creator.
      expect(data.createdBy).toBe(USER_ID);
    });

    // INV-005 / INV-003: createdBy / updatedBy are API-owned. A create body
    // carrying them must never reach Prisma — the allow-listed mapper drops
    // them and the session user is the only source.
    it('ignores createdBy / updatedBy supplied in the create body', async () => {
      prisma.commonArea.findFirst.mockResolvedValue(makeArea());
      prisma.inventoryItem.create.mockResolvedValue(makeItem());

      const maliciousBody = {
        name: 'Coffee Machine',
        category: InventoryCategoryDto.APPLIANCES,
        commonAreaId: AREA_ID,
        createdBy: 'attacker-user',
        updatedBy: 'attacker-user',
      } as unknown as CreateInventoryItemDto;

      await service.createItem(CONDOMINIUM_ID, USER_ID, maliciousBody);

      const data = prisma.inventoryItem.create.mock.calls[0][0].data;
      expect(data.createdBy).toBe(USER_ID);
      // updatedBy is not written on create (Prisma defaults the column to null);
      // the allow-listed mapper guarantees the body cannot inject it either.
      expect(data).not.toHaveProperty('updatedBy');
    });
  });

  describe('updateItem', () => {
    it('persists updatedBy from the acting user and never writes createdBy', async () => {
      prisma.inventoryItem.findFirst
        .mockResolvedValueOnce(makeItem())
        .mockResolvedValueOnce(makeItem({ name: 'Renamed', updatedBy: USER_ID }));

      await service.updateItem(CONDOMINIUM_ID, USER_ID, ITEM_ID, {
        name: 'Renamed',
      });

      expect(prisma.inventoryItem.updateMany).toHaveBeenCalledTimes(1);
      const data = prisma.inventoryItem.updateMany.mock.calls[0][0].data;
      expect(data.updatedBy).toBe(USER_ID);
      // createdBy is immutable after creation — an update must not touch it.
      expect(data).not.toHaveProperty('createdBy');
    });

    // INV-005 / INV-003: a PATCH body carrying createdBy / updatedBy must not
    // override the session-derived actor.
    it('ignores createdBy / updatedBy supplied in the update body', async () => {
      prisma.inventoryItem.findFirst
        .mockResolvedValueOnce(makeItem())
        .mockResolvedValueOnce(makeItem({ name: 'Renamed' }));

      const maliciousBody = {
        name: 'Renamed',
        createdBy: 'attacker-user',
        updatedBy: 'attacker-user',
      } as unknown as UpdateInventoryItemDto;

      await service.updateItem(CONDOMINIUM_ID, USER_ID, ITEM_ID, maliciousBody);

      const data = prisma.inventoryItem.updateMany.mock.calls[0][0].data;
      expect(data.updatedBy).toBe(USER_ID);
      expect(data).not.toHaveProperty('createdBy');
    });
  });

  describe('findAllItems', () => {
    it('returns rows carrying all four audit fields in the data/meta envelope', async () => {
      const item = makeItem({ createdBy: USER_ID, updatedBy: USER_ID });
      prisma.inventoryItem.findMany.mockResolvedValueOnce([item]);
      prisma.inventoryItem.count.mockResolvedValueOnce(1);

      const result = await service.findAllItems(CONDOMINIUM_ID);

      expect(result.meta).toEqual(
        expect.objectContaining({ total: 1, page: 1 }),
      );
      const row = (result.data as Array<Record<string, unknown>>)[0];
      // The list contract exposes createdAt, updatedAt, createdBy, updatedBy.
      expect(row).toHaveProperty('createdAt');
      expect(row).toHaveProperty('updatedAt');
      expect(row.createdBy).toBe(USER_ID);
      expect(row.updatedBy).toBe(USER_ID);
    });
  });
});
