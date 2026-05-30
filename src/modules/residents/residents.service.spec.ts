import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { ResidentsService } from './residents.service';
import { UpdateResidentDto } from './dto/update-resident.dto';
import { CreateResidentDto, ResidentTypeDto } from './dto/create-resident.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { CreatePetDto, PetTypeDto } from './dto/create-pet.dto';
import { CreateAdditionalResidentDto } from './dto/create-additional-resident.dto';

const CONDOMINIUM_ID = 'cond-1';
const USER_ID = 'user-42';
const RESIDENT_ID = 'res-1';
const VEHICLE_ID = 'veh-1';
const PET_ID = 'pet-1';
const ADDITIONAL_RESIDENT_ID = 'addl-1';

interface PrismaMock {
  resident: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  vehicle: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  pet: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  additionalResident: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  auditLog: {
    findMany: jest.Mock;
  };
  condominiumSettings: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface AuditMock {
  log: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock = {
    resident: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    vehicle: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pet: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    additionalResident: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    condominiumSettings: {
      findUnique: jest.fn().mockResolvedValue(null),
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

function makeService(prisma: PrismaMock, audit: AuditMock): ResidentsService {
  return new ResidentsService(prisma as never, audit as never);
}

function makeResident(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RESIDENT_ID,
    condominiumId: CONDOMINIUM_ID,
    unitNumber: 'A01',
    residentType: 'OWNER',
    firstName: 'Carlos',
    lastName: 'Mendoza',
    phone: null,
    secondaryPhone: null,
    email: null,
    paymentStatus: 'CURRENT',
    debt: 0,
    monthlyFee: 0,
    parkingSpots: 0,
    documentation: {},
    notes: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    vehicles: [],
    pets: [],
    additionalResidents: [],
    ...overrides,
  };
}

function makeVehicle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VEHICLE_ID,
    residentId: RESIDENT_ID,
    condominiumId: CONDOMINIUM_ID,
    make: 'Toyota',
    model: 'Corolla',
    color: 'White',
    plates: 'ABC-1234',
    hasTag: false,
    tagId: null,
    ...overrides,
  };
}

function makePet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PET_ID,
    residentId: RESIDENT_ID,
    name: 'Max',
    petType: 'DOG',
    description: null,
    ...overrides,
  };
}

function makeAdditionalResident(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: ADDITIONAL_RESIDENT_ID,
    residentId: RESIDENT_ID,
    name: 'María González',
    residentType: 'RESIDENT',
    phone: null,
    secondaryPhone: null,
    email: null,
    relationship: 'Spouse',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const createResidentDto: CreateResidentDto = {
  unitNumber: 'A01',
  residentType: ResidentTypeDto.OWNER,
  firstName: 'Carlos',
  lastName: 'Mendoza',
};

const createVehicleDto: CreateVehicleDto = {
  make: 'Toyota',
  model: 'Corolla',
  plates: 'ABC-1234',
};

const createPetDto: CreatePetDto = {
  name: 'Max',
  petType: PetTypeDto.DOG,
};

const createAdditionalResidentDto: CreateAdditionalResidentDto = {
  name: 'María González',
  residentType: ResidentTypeDto.RESIDENT,
  relationship: 'Spouse',
};

describe('ResidentsService — Phase 1 API safety net', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: ResidentsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = makeService(prisma, audit);
  });

  describe('RES-002 — mass assignment is blocked', () => {
    // `paymentStatus` is intentionally absent from this list: Phase 2 (RES-004)
    // promoted it to a validated field of the update contract. `debt` stays
    // unsafe — it is excluded by the RES-004 product decision (derived figure).
    it('never forwards condominiumId / deletedAt / debt to Prisma on update', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(makeResident({ firstName: 'New Name' }));

      const maliciousDto = {
        firstName: 'New Name',
        condominiumId: 'evil-tenant',
        deletedAt: new Date(),
        debt: 999,
        id: 'spoofed-id',
      } as unknown as UpdateResidentDto;

      await service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, maliciousDto);

      const updateArg = prisma.resident.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('condominiumId');
      expect(updateArg.data).not.toHaveProperty('deletedAt');
      expect(updateArg.data).not.toHaveProperty('debt');
      expect(updateArg.data).not.toHaveProperty('id');
      expect(updateArg.data).toHaveProperty('firstName', 'New Name');
    });
  });

  describe('RES-003 — exactly one audit row per mutation', () => {
    it('logs RESIDENT_CREATED on create', async () => {
      prisma.resident.findFirst.mockResolvedValue(null);
      prisma.resident.create.mockResolvedValue(makeResident());

      await service.create(CONDOMINIUM_ID, USER_ID, createResidentDto);

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESIDENT_CREATED',
          actionCategory: 'CREATE',
          module: 'residents',
          entityType: 'Resident',
          userId: USER_ID,
        }),
        prisma,
      );
    });

    it('logs RESIDENT_UPDATED on update', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(makeResident({ firstName: 'New' }));

      await service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, {
        firstName: 'New',
      });

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_UPDATED', entityType: 'Resident' }),
        prisma,
      );
    });

    it('logs RESIDENT_DELETED on remove', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(makeResident({ deletedAt: new Date() }));

      await service.remove(CONDOMINIUM_ID, USER_ID, RESIDENT_ID);

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_DELETED', entityType: 'Resident' }),
        prisma,
      );
    });

    it('soft-deletes every found resident and logs one RESIDENT_DELETED each on removeMany', async () => {
      const a = makeResident({ id: 'res-a' });
      const b = makeResident({ id: 'res-b' });
      prisma.resident.findMany.mockResolvedValue([a, b]);
      prisma.resident.update.mockResolvedValue(makeResident({ deletedAt: new Date() }));

      const result = await service.removeMany(CONDOMINIUM_ID, USER_ID, [
        'res-a',
        'res-b',
      ]);

      expect(result).toEqual({ deleted: 2, requested: 2 });
      expect(prisma.resident.update).toHaveBeenCalledTimes(2);
      expect(audit.log).toHaveBeenCalledTimes(2);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_DELETED', entityId: 'res-a' }),
        prisma,
      );
    });

    it('skips not-found ids without aborting the batch on removeMany', async () => {
      // Only one of the two requested ids exists / is not yet deleted.
      prisma.resident.findMany.mockResolvedValue([makeResident({ id: 'res-a' })]);
      prisma.resident.update.mockResolvedValue(makeResident({ deletedAt: new Date() }));

      const result = await service.removeMany(CONDOMINIUM_ID, USER_ID, [
        'res-a',
        'res-missing',
      ]);

      expect(result).toEqual({ deleted: 1, requested: 2 });
      expect(prisma.resident.update).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledTimes(1);
    });

    it('de-duplicates ids before counting requested on removeMany', async () => {
      prisma.resident.findMany.mockResolvedValue([makeResident({ id: 'res-a' })]);
      prisma.resident.update.mockResolvedValue(makeResident({ deletedAt: new Date() }));

      const result = await service.removeMany(CONDOMINIUM_ID, USER_ID, [
        'res-a',
        'res-a',
      ]);

      expect(result).toEqual({ deleted: 1, requested: 1 });
    });

    it('logs RESIDENT_VEHICLE_ADDED on addVehicle', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.vehicle.create.mockResolvedValue(makeVehicle());

      await service.addVehicle(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, createVehicleDto);

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_VEHICLE_ADDED', entityType: 'Vehicle' }),
        prisma,
      );
    });

    it('logs RESIDENT_VEHICLE_UPDATED on updateVehicle', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.vehicle.findFirst.mockResolvedValue(makeVehicle());
      prisma.vehicle.update.mockResolvedValue(makeVehicle({ color: 'Black' }));

      await service.updateVehicle(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, VEHICLE_ID, {
        color: 'Black',
      });

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_VEHICLE_UPDATED' }),
        prisma,
      );
    });

    it('logs RESIDENT_VEHICLE_REMOVED on removeVehicle', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.vehicle.findFirst.mockResolvedValue(makeVehicle());
      prisma.vehicle.delete.mockResolvedValue(makeVehicle());

      await service.removeVehicle(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, VEHICLE_ID);

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_VEHICLE_REMOVED' }),
        prisma,
      );
    });

    it('logs RESIDENT_PET_ADDED on addPet', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.pet.create.mockResolvedValue(makePet());

      await service.addPet(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, createPetDto);

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_PET_ADDED', entityType: 'Pet' }),
        prisma,
      );
    });

    it('logs RESIDENT_PET_UPDATED on updatePet', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.pet.findFirst.mockResolvedValue(makePet());
      prisma.pet.update.mockResolvedValue(makePet({ name: 'Rex' }));

      await service.updatePet(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, PET_ID, {
        name: 'Rex',
      });

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_PET_UPDATED' }),
        prisma,
      );
    });

    it('logs RESIDENT_PET_REMOVED on removePet', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.pet.findFirst.mockResolvedValue(makePet());
      prisma.pet.delete.mockResolvedValue(makePet());

      await service.removePet(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, PET_ID);

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESIDENT_PET_REMOVED' }),
        prisma,
      );
    });
  });

  describe('RES-008 — atomic mutation flow', () => {
    it('rejects the mutation when the audit write fails', async () => {
      prisma.resident.findFirst.mockResolvedValue(null);
      prisma.resident.create.mockResolvedValue(makeResident());
      audit.log.mockRejectedValueOnce(new Error('audit write failed'));

      await expect(
        service.create(CONDOMINIUM_ID, USER_ID, createResidentDto),
      ).rejects.toThrow('audit write failed');
    });

    it('does not write an audit row when the data mutation fails', async () => {
      prisma.resident.findFirst.mockResolvedValue(null);
      prisma.resident.create.mockRejectedValue(new Error('db write failed'));

      await expect(
        service.create(CONDOMINIUM_ID, USER_ID, createResidentDto),
      ).rejects.toThrow('db write failed');
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('RES-016 — unit-number collision returns 409', () => {
    it('throws ConflictException when another active resident holds the unit', async () => {
      prisma.resident.findFirst
        .mockResolvedValueOnce(makeResident({ unitNumber: 'A01' }))
        .mockResolvedValueOnce(makeResident({ id: 'other-res', unitNumber: 'B02' }));

      await expect(
        service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, { unitNumber: 'B02' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.resident.update).not.toHaveBeenCalled();
    });

    it('maps a Prisma P2002 unique violation to ConflictException', async () => {
      prisma.resident.findFirst
        .mockResolvedValueOnce(makeResident({ unitNumber: 'A01' }))
        .mockResolvedValueOnce(null);
      prisma.resident.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, { unitNumber: 'B02' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

describe('ResidentsService — Phase 2 API contract completion', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: ResidentsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = makeService(prisma, audit);
  });

  describe('RES-004 — resident update contract', () => {
    it('persists paymentStatus through the validated mapper', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(
        makeResident({ paymentStatus: 'OVERDUE' }),
      );

      await service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, {
        paymentStatus: PaymentStatus.OVERDUE,
      });

      const updateArg = prisma.resident.update.mock.calls[0][0];
      expect(updateArg.data).toHaveProperty('paymentStatus', PaymentStatus.OVERDUE);
    });

    it('persists documentation as a complete five-key object', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(makeResident());
      const documentation = {
        propertyTax: true,
        titleDeed: false,
        ownerDocumentation: true,
        nationalId: false,
        proofOfAddress: true,
      };

      await service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, { documentation });

      const updateArg = prisma.resident.update.mock.calls[0][0];
      expect(updateArg.data.documentation).toEqual(documentation);
    });

    it('leaves documentation untouched when the field is omitted', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(makeResident());

      await service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, {
        firstName: 'New',
      });

      const updateArg = prisma.resident.update.mock.calls[0][0];
      expect(updateArg.data.documentation).toBeUndefined();
    });

    it('keeps debt out of the update contract (product decision: derived)', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(makeResident());

      await service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, {
        debt: 5000,
      } as unknown as UpdateResidentDto);

      const updateArg = prisma.resident.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('debt');
    });
  });

  describe('RES-005 — additional resident CRUD', () => {
    it('creates an additional resident, returns it, and audits once', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.additionalResident.create.mockResolvedValue(makeAdditionalResident());

      const result = await service.addAdditionalResident(
        CONDOMINIUM_ID,
        USER_ID,
        RESIDENT_ID,
        createAdditionalResidentDto,
      );

      expect(result).toEqual(makeAdditionalResident());
      expect(prisma.additionalResident.create).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESIDENT_ADDITIONAL_RESIDENT_ADDED',
          actionCategory: 'CREATE',
          module: 'residents',
          entityType: 'AdditionalResident',
          userId: USER_ID,
        }),
        prisma,
      );
    });

    it('updates an additional resident, returns it, and audits once', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.additionalResident.findFirst.mockResolvedValue(makeAdditionalResident());
      prisma.additionalResident.update.mockResolvedValue(
        makeAdditionalResident({ name: 'Updated Name' }),
      );

      const result = await service.updateAdditionalResident(
        CONDOMINIUM_ID,
        USER_ID,
        RESIDENT_ID,
        ADDITIONAL_RESIDENT_ID,
        { name: 'Updated Name' },
      );

      expect(result).toEqual(makeAdditionalResident({ name: 'Updated Name' }));
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESIDENT_ADDITIONAL_RESIDENT_UPDATED',
          entityType: 'AdditionalResident',
        }),
        prisma,
      );
    });

    it('deletes an additional resident, returns it, and audits once', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.additionalResident.findFirst.mockResolvedValue(makeAdditionalResident());
      prisma.additionalResident.delete.mockResolvedValue(makeAdditionalResident());

      const result = await service.removeAdditionalResident(
        CONDOMINIUM_ID,
        USER_ID,
        RESIDENT_ID,
        ADDITIONAL_RESIDENT_ID,
      );

      expect(result).toEqual(makeAdditionalResident());
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESIDENT_ADDITIONAL_RESIDENT_REMOVED',
          entityType: 'AdditionalResident',
        }),
        prisma,
      );
    });

    it('rejects the mutation when the parent resident is outside the active condominium', async () => {
      prisma.resident.findFirst.mockResolvedValue(null);

      await expect(
        service.addAdditionalResident(
          CONDOMINIUM_ID,
          USER_ID,
          RESIDENT_ID,
          createAdditionalResidentDto,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.additionalResident.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('rejects an update for an additional resident not under the parent', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.additionalResident.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAdditionalResident(
          CONDOMINIUM_ID,
          USER_ID,
          RESIDENT_ID,
          ADDITIONAL_RESIDENT_ID,
          { name: 'X' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.additionalResident.update).not.toHaveBeenCalled();
    });

    it('rejects the whole mutation when the audit write fails (transactional)', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.additionalResident.create.mockResolvedValue(makeAdditionalResident());
      audit.log.mockRejectedValueOnce(new Error('audit write failed'));

      await expect(
        service.addAdditionalResident(
          CONDOMINIUM_ID,
          USER_ID,
          RESIDENT_ID,
          createAdditionalResidentDto,
        ),
      ).rejects.toThrow('audit write failed');
    });
  });
});

describe('ResidentsService — Phase 5 scale & consistency', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: ResidentsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = makeService(prisma, audit);
  });

  describe('RES-009 — server-side pagination, filtering & sorting', () => {
    it('fetches all IDs for natural-sort pagination and applies skip/take in-memory for unitNumber sort', async () => {
      // Simulate 30 residents; page 3 with limit 10 should pick IDs 20–29.
      const fakeItems = Array.from({ length: 30 }, (_, i) => ({
        id: `res-${i + 1}`,
        unitNumber: String(i + 1),
      }));
      prisma.resident.findMany
        .mockResolvedValueOnce(fakeItems) // lightweight select call
        .mockResolvedValueOnce([]);       // full-records call

      const result = await service.findAll(CONDOMINIUM_ID, { page: 3, limit: 10 });

      // First call is the lightweight select — no DB-level skip/take/orderBy.
      const selectCall = prisma.resident.findMany.mock.calls[0][0];
      expect(selectCall.select).toEqual({ id: true, unitNumber: true });
      expect(selectCall.skip).toBeUndefined();
      expect(selectCall.take).toBeUndefined();
      expect(selectCall.orderBy).toBeUndefined();
      expect(selectCall.where).toEqual({ condominiumId: CONDOMINIUM_ID, deletedAt: null });

      // Second call fetches the page slice (IDs 20–29 after numeric sort).
      const pageCall = prisma.resident.findMany.mock.calls[1][0];
      expect(pageCall.where.id.in).toHaveLength(10);
      expect(pageCall.where.id.in[0]).toBe('res-21');
      expect(pageCall.where.id.in[9]).toBe('res-30');

      // Meta reflects in-memory pagination.
      expect(result.meta).toMatchObject({ total: 30, page: 3, limit: 10, totalPages: 3 });
    });

    it('always scopes the query to the tenant and excludes soft-deleted rows', async () => {
      await service.findAll(CONDOMINIUM_ID, { q: 'A1', paymentStatus: PaymentStatus.OVERDUE });

      const where = prisma.resident.findMany.mock.calls[0][0].where;
      expect(where.condominiumId).toBe(CONDOMINIUM_ID);
      expect(where.deletedAt).toBeNull();
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { paymentStatus: PaymentStatus.OVERDUE },
          {
            OR: [
              { unitNumber: { contains: 'A1', mode: 'insensitive' } },
              { firstName: { contains: 'A1', mode: 'insensitive' } },
              { lastName: { contains: 'A1', mode: 'insensitive' } },
            ],
          },
        ]),
      );
    });

    it('translates table filters into database conditions', async () => {
      await service.findAll(CONDOMINIUM_ID, {
        unitNumber: 'A01',
        unitExact: true,
        minDebt: 500,
        hasVehicles: true,
        hasTag: false,
        hasPets: false,
      });

      const where = prisma.resident.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { unitNumber: { equals: 'A01', mode: 'insensitive' } },
          { debt: { gte: 500 } },
          { vehicles: { some: {} } },
          { vehicles: { none: { hasTag: true } } },
          { pets: { none: {} } },
        ]),
      );
    });

    it('builds a JSON-path clause for the documentation completeness filter', async () => {
      await service.findAll(CONDOMINIUM_ID, { documentation: 'complete' });

      const where = prisma.resident.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({
        AND: [
          { documentation: { path: ['propertyTax'], equals: true } },
          { documentation: { path: ['titleDeed'], equals: true } },
          { documentation: { path: ['ownerDocumentation'], equals: true } },
          { documentation: { path: ['nationalId'], equals: true } },
          { documentation: { path: ['proofOfAddress'], equals: true } },
        ],
      });
    });

    it('negates the documentation clause for the incomplete filter', async () => {
      await service.findAll(CONDOMINIUM_ID, { documentation: 'incomplete' });

      const where = prisma.resident.findMany.mock.calls[0][0].where;
      const docClause = where.AND.find(
        (c: Record<string, unknown>) => 'NOT' in c,
      );
      expect(docClause).toBeDefined();
      expect(docClause.NOT.AND).toHaveLength(5);
    });

    it('maps sortBy/sortDirection to a deterministic orderBy with a tiebreaker', async () => {
      await service.findAll(CONDOMINIUM_ID, { sortBy: 'debt', sortDirection: 'desc' });

      const orderBy = prisma.resident.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual([{ debt: 'desc' }, { id: 'asc' }]);
    });

    it('sorts by composite name fields when sortBy is name', async () => {
      await service.findAll(CONDOMINIUM_ID, { sortBy: 'name', sortDirection: 'asc' });

      const orderBy = prisma.resident.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual([
        { lastName: 'asc' },
        { firstName: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('returns pagination meta with total derived from the full id-set for unitNumber sort', async () => {
      const fakeItems = Array.from({ length: 57 }, (_, i) => ({
        id: `res-${i + 1}`,
        unitNumber: String(i + 1),
      }));
      prisma.resident.findMany
        .mockResolvedValueOnce(fakeItems) // lightweight select call
        .mockResolvedValueOnce([]);       // full-records call

      const result = await service.findAll(CONDOMINIUM_ID, { page: 2, limit: 25 });

      expect(result.meta).toMatchObject({
        total: 57,
        page: 2,
        limit: 25,
        totalPages: 3,
      });
    });

    it('sorts unitNumber values numerically so 2 comes before 10', async () => {
      const fakeItems = [
        { id: 'id-10', unitNumber: '10' },
        { id: 'id-2', unitNumber: '2' },
        { id: 'id-1', unitNumber: '1' },
      ];
      prisma.resident.findMany
        .mockResolvedValueOnce(fakeItems)
        .mockResolvedValueOnce([]);

      await service.findAll(CONDOMINIUM_ID, { page: 1, limit: 10 });

      const pageCall = prisma.resident.findMany.mock.calls[1][0];
      expect(pageCall.where.id.in).toEqual(['id-1', 'id-2', 'id-10']);
    });

    it('reverses numeric sort order when sortDirection is desc', async () => {
      const fakeItems = [
        { id: 'id-10', unitNumber: '10' },
        { id: 'id-2', unitNumber: '2' },
        { id: 'id-1', unitNumber: '1' },
      ];
      prisma.resident.findMany
        .mockResolvedValueOnce(fakeItems)
        .mockResolvedValueOnce([]);

      await service.findAll(CONDOMINIUM_ID, { sortDirection: 'desc', page: 1, limit: 10 });

      const pageCall = prisma.resident.findMany.mock.calls[1][0];
      expect(pageCall.where.id.in).toEqual(['id-10', 'id-2', 'id-1']);
    });

    it('folds the condominium fee/currency settings into meta.condominium as strings', async () => {
      prisma.resident.findMany.mockResolvedValue([]);
      prisma.resident.count.mockResolvedValue(0);
      prisma.condominiumSettings.findUnique.mockResolvedValue({
        ordinaryFeeAmount: new Prisma.Decimal('1500.50'),
        lateFeeAmount: new Prisma.Decimal('250'),
        currency: 'USD',
      });

      const result = await service.findAll(CONDOMINIUM_ID);

      const settingsArg = prisma.condominiumSettings.findUnique.mock.calls[0][0];
      expect(settingsArg.where).toEqual({ condominiumId: CONDOMINIUM_ID });
      expect(result.meta.condominium).toEqual({
        ordinaryFeeAmount: '1500.5',
        lateFeeAmount: '250',
        currency: 'USD',
      });
    });

    it('defaults meta.condominium to 0/0/MXN when no settings row exists', async () => {
      prisma.resident.findMany.mockResolvedValue([]);
      prisma.resident.count.mockResolvedValue(0);
      prisma.condominiumSettings.findUnique.mockResolvedValue(null);

      const result = await service.findAll(CONDOMINIUM_ID);

      expect(result.meta.condominium).toEqual({
        ordinaryFeeAmount: '0',
        lateFeeAmount: '0',
        currency: 'MXN',
      });
    });

    it('counts with the same where clause it queries with (non-unitNumber sort)', async () => {
      await service.findAll(CONDOMINIUM_ID, { q: 'Lopez', sortBy: 'name' });

      const findWhere = prisma.resident.findMany.mock.calls[0][0].where;
      const countWhere = prisma.resident.count.mock.calls[0][0].where;
      expect(countWhere).toEqual(findWhere);
    });

    it('tokenizes a multi-word name into one AND clause per word', async () => {
      await service.findAll(CONDOMINIUM_ID, { name: 'Jose Omar Barron Elias' });

      const where = prisma.resident.findMany.mock.calls[0][0].where;
      // Each word becomes its own OR(firstName|lastName) clause, AND-ed together,
      // so "Jose Omar" (firstName) + "Barron Elias" (lastName) all match.
      expect(where.AND).toEqual([
        { OR: [
          { firstName: { contains: 'Jose', mode: 'insensitive' } },
          { lastName: { contains: 'Jose', mode: 'insensitive' } },
        ] },
        { OR: [
          { firstName: { contains: 'Omar', mode: 'insensitive' } },
          { lastName: { contains: 'Omar', mode: 'insensitive' } },
        ] },
        { OR: [
          { firstName: { contains: 'Barron', mode: 'insensitive' } },
          { lastName: { contains: 'Barron', mode: 'insensitive' } },
        ] },
        { OR: [
          { firstName: { contains: 'Elias', mode: 'insensitive' } },
          { lastName: { contains: 'Elias', mode: 'insensitive' } },
        ] },
      ]);
    });

    it('attaches lastModifiedByName from the latest resident audit row', async () => {
      prisma.resident.findMany.mockResolvedValue([
        makeResident({ id: 'res-a' }),
        makeResident({ id: 'res-b' }),
      ]);
      prisma.resident.count.mockResolvedValue(2);
      prisma.auditLog.findMany.mockResolvedValue([
        // orderBy createdAt desc: the first row per entityId is the latest.
        { entityId: 'res-a', user: { firstName: 'Carlos', lastName: 'Mendoza' } },
        { entityId: 'res-a', user: { firstName: 'Older', lastName: 'Actor' } },
        { entityId: 'res-b', user: { firstName: 'Ana', lastName: 'Lopez' } },
      ]);

      const result = await service.findAll(CONDOMINIUM_ID);

      const auditArg = prisma.auditLog.findMany.mock.calls[0][0];
      expect(auditArg.where).toMatchObject({
        entityType: 'Resident',
        entityId: { in: ['res-a', 'res-b'] },
      });
      const rows = result.data as Array<{ id: string; lastModifiedByName: string | null }>;
      expect(rows.find((r) => r.id === 'res-a')?.lastModifiedByName).toBe('Carlos Mendoza');
      expect(rows.find((r) => r.id === 'res-b')?.lastModifiedByName).toBe('Ana Lopez');
    });

    it('sets lastModifiedByName to null when a resident has no audit row', async () => {
      prisma.resident.findMany.mockResolvedValue([makeResident({ id: 'res-x' })]);
      prisma.resident.count.mockResolvedValue(1);
      prisma.auditLog.findMany.mockResolvedValue([]);

      const result = await service.findAll(CONDOMINIUM_ID);

      const rows = result.data as Array<{ lastModifiedByName: string | null }>;
      expect(rows[0].lastModifiedByName).toBeNull();
    });
  });

  describe('RES-012 — pet tenant-isolation depth', () => {
    it('stores condominiumId when a pet is created', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.pet.create.mockResolvedValue(makePet());

      await service.addPet(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, createPetDto);

      const createArg = prisma.pet.create.mock.calls[0][0];
      expect(createArg.data).toHaveProperty('condominiumId', CONDOMINIUM_ID);
      expect(createArg.data).toHaveProperty('residentId', RESIDENT_ID);
    });

    it('filters by condominiumId when updating a pet', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.pet.findFirst.mockResolvedValue(makePet());
      prisma.pet.update.mockResolvedValue(makePet({ name: 'Rex' }));

      await service.updatePet(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, PET_ID, {
        name: 'Rex',
      });

      expect(prisma.pet.findFirst).toHaveBeenCalledWith({
        where: { id: PET_ID, residentId: RESIDENT_ID, condominiumId: CONDOMINIUM_ID },
      });
    });

    it('filters by condominiumId when removing a pet', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.pet.findFirst.mockResolvedValue(makePet());
      prisma.pet.delete.mockResolvedValue(makePet());

      await service.removePet(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, PET_ID);

      expect(prisma.pet.findFirst).toHaveBeenCalledWith({
        where: { id: PET_ID, residentId: RESIDENT_ID, condominiumId: CONDOMINIUM_ID },
      });
    });
  });
});

describe('ResidentsService — Phase 6 tests & maintainability', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: ResidentsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = makeService(prisma, audit);
  });

  describe('RES-017 — soft delete', () => {
    it('soft-deletes by stamping deletedAt instead of hard-deleting the row', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(
        makeResident({ deletedAt: new Date() }),
      );

      await service.remove(CONDOMINIUM_ID, USER_ID, RESIDENT_ID);

      const updateArg = prisma.resident.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: RESIDENT_ID });
      expect(updateArg.data.deletedAt).toBeInstanceOf(Date);
    });

    it('scopes findAll to non-deleted rows so soft-deleted residents never surface', async () => {
      await service.findAll(CONDOMINIUM_ID);

      // The first findMany is the lightweight select used for in-memory sorting.
      expect(prisma.resident.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    });

    it('throws NotFoundException when deleting an already soft-deleted resident', async () => {
      // remove() looks the resident up with deletedAt: null, so a row that is
      // already soft-deleted is not found — it cannot be deleted twice.
      prisma.resident.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(CONDOMINIUM_ID, USER_ID, RESIDENT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.resident.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('RES-017 — audit before/after state content', () => {
    it('records only afterState on create', async () => {
      prisma.resident.findFirst.mockResolvedValue(null);
      prisma.resident.create.mockResolvedValue(makeResident());

      await service.create(CONDOMINIUM_ID, USER_ID, createResidentDto);

      const auditArg = audit.log.mock.calls[0][0];
      expect(auditArg.actionCategory).toBe('CREATE');
      expect(auditArg.afterState).toBeDefined();
      expect(auditArg).not.toHaveProperty('beforeState');
    });

    it('records both beforeState and afterState on update', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(
        makeResident({ firstName: 'New' }),
      );

      await service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, {
        firstName: 'New',
      });

      const auditArg = audit.log.mock.calls[0][0];
      expect(auditArg.actionCategory).toBe('UPDATE');
      expect(auditArg.beforeState).toBeDefined();
      expect(auditArg.afterState).toBeDefined();
      expect(auditArg.beforeState).not.toEqual(auditArg.afterState);
    });

    it('records only beforeState on delete', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(
        makeResident({ deletedAt: new Date() }),
      );

      await service.remove(CONDOMINIUM_ID, USER_ID, RESIDENT_ID);

      const auditArg = audit.log.mock.calls[0][0];
      expect(auditArg.actionCategory).toBe('DELETE');
      expect(auditArg.beforeState).toBeDefined();
      expect(auditArg).not.toHaveProperty('afterState');
    });
  });

  describe('RES-019 — vehicle overflow is advisory-only', () => {
    it('adds a vehicle even when the resident has no parking spots (no server enforcement)', async () => {
      prisma.resident.findFirst.mockResolvedValue({ id: RESIDENT_ID });
      prisma.vehicle.create.mockResolvedValue(makeVehicle());

      await expect(
        service.addVehicle(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, createVehicleDto),
      ).resolves.toBeDefined();
      expect(prisma.vehicle.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('RES-009 — residents past the former 500-row cap stay reachable', () => {
    it('pages deep into the dataset with in-memory skip/take for unitNumber sort', async () => {
      const fakeItems = Array.from({ length: 1200 }, (_, i) => ({
        id: `res-${i + 1}`,
        unitNumber: String(i + 1),
      }));
      prisma.resident.findMany
        .mockResolvedValueOnce(fakeItems) // lightweight select
        .mockResolvedValueOnce([]);       // full-records call

      const result = await service.findAll(CONDOMINIUM_ID, { page: 2, limit: 500 });

      // The page-records call receives exactly 500 IDs (items 501–1000 after sort).
      const pageCall = prisma.resident.findMany.mock.calls[1][0];
      expect(pageCall.where.id.in).toHaveLength(500);
      expect(pageCall.where.id.in[0]).toBe('res-501');

      expect(result.meta).toMatchObject({
        total: 1200,
        page: 2,
        limit: 500,
        totalPages: 3,
      });
    });
  });
});
