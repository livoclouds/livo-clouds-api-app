import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ResidentsService } from './residents.service';
import { UpdateResidentDto } from './dto/update-resident.dto';
import { CreateResidentDto, ResidentTypeDto } from './dto/create-resident.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { CreatePetDto, PetTypeDto } from './dto/create-pet.dto';

const CONDOMINIUM_ID = 'cond-1';
const USER_ID = 'user-42';
const RESIDENT_ID = 'res-1';
const VEHICLE_ID = 'veh-1';
const PET_ID = 'pet-1';

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
    it('never forwards condominiumId / deletedAt / debt to Prisma on update', async () => {
      prisma.resident.findFirst.mockResolvedValue(makeResident());
      prisma.resident.update.mockResolvedValue(makeResident({ firstName: 'New Name' }));

      const maliciousDto = {
        firstName: 'New Name',
        condominiumId: 'evil-tenant',
        deletedAt: new Date(),
        debt: 999,
        id: 'spoofed-id',
        paymentStatus: 'OVERDUE',
      } as unknown as UpdateResidentDto;

      await service.update(CONDOMINIUM_ID, USER_ID, RESIDENT_ID, maliciousDto);

      const updateArg = prisma.resident.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('condominiumId');
      expect(updateArg.data).not.toHaveProperty('deletedAt');
      expect(updateArg.data).not.toHaveProperty('debt');
      expect(updateArg.data).not.toHaveProperty('id');
      expect(updateArg.data).not.toHaveProperty('paymentStatus');
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
