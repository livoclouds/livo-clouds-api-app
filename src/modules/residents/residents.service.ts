import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/types';
import { AuditService } from '../audit/audit.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListResidentsDto } from './dto/list-residents.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { UpdateResidentDto } from './dto/update-resident.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

const RESIDENTS_MODULE = 'residents';

const AUDIT_ACTION = {
  RESIDENT_CREATED: 'RESIDENT_CREATED',
  RESIDENT_UPDATED: 'RESIDENT_UPDATED',
  RESIDENT_DELETED: 'RESIDENT_DELETED',
  VEHICLE_ADDED: 'RESIDENT_VEHICLE_ADDED',
  VEHICLE_UPDATED: 'RESIDENT_VEHICLE_UPDATED',
  VEHICLE_REMOVED: 'RESIDENT_VEHICLE_REMOVED',
  PET_ADDED: 'RESIDENT_PET_ADDED',
  PET_UPDATED: 'RESIDENT_PET_UPDATED',
  PET_REMOVED: 'RESIDENT_PET_REMOVED',
} as const;

const RESIDENT_INCLUDE = {
  vehicles: true,
  pets: true,
  additionalResidents: true,
} satisfies Prisma.ResidentInclude;

@Injectable()
export class ResidentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll(
    condominiumId: string,
    dto: ListResidentsDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 500;
    const skip = (page - 1) * limit;

    const where: Prisma.ResidentWhereInput = {
      condominiumId,
      deletedAt: null,
      ...(dto.paymentStatus ? { paymentStatus: dto.paymentStatus } : {}),
      ...(dto.q
        ? {
            OR: [
              { unitNumber: { contains: dto.q, mode: 'insensitive' } },
              { firstName: { contains: dto.q, mode: 'insensitive' } },
              { lastName: { contains: dto.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.resident.findMany({
        where,
        include: {
          vehicles: true,
          pets: true,
          additionalResidents: true,
        },
        orderBy: { unitNumber: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.resident.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(condominiumId: string, id: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id, condominiumId, deletedAt: null },
      include: {
        vehicles: true,
        pets: true,
        additionalResidents: true,
        collectionRecords: { orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 12 },
      },
    });

    if (!resident) {
      throw new NotFoundException('Resident not found');
    }

    return resident;
  }

  async create(condominiumId: string, userId: string, dto: CreateResidentDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.resident.findFirst({
        where: { condominiumId, unitNumber: dto.unitNumber, deletedAt: null },
      });

      if (existing) {
        throw new ConflictException(
          `Unit ${dto.unitNumber} already has an active resident`,
        );
      }

      const resident = await tx.resident.create({
        data: this.toResidentCreateData(condominiumId, dto),
        include: RESIDENT_INCLUDE,
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.RESIDENT_CREATED,
          actionCategory: 'CREATE',
          module: RESIDENTS_MODULE,
          entityType: 'Resident',
          entityId: resident.id,
          afterState: resident,
          result: 'SUCCESS',
        },
        tx,
      );

      return resident;
    });
  }

  async update(
    condominiumId: string,
    userId: string,
    id: string,
    dto: UpdateResidentDto,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.resident.findFirst({
          where: { id, condominiumId, deletedAt: null },
          include: RESIDENT_INCLUDE,
        });
        if (!before) throw new NotFoundException('Resident not found');

        if (dto.unitNumber && dto.unitNumber !== before.unitNumber) {
          const collision = await tx.resident.findFirst({
            where: {
              condominiumId,
              unitNumber: dto.unitNumber,
              deletedAt: null,
              id: { not: id },
            },
          });
          if (collision) {
            throw new ConflictException(
              `Unit ${dto.unitNumber} already has an active resident`,
            );
          }
        }

        const updated = await tx.resident.update({
          where: { id },
          data: this.toResidentUpdateData(dto),
          include: RESIDENT_INCLUDE,
        });

        await this.audit.log(
          {
            condominiumId,
            userId,
            action: AUDIT_ACTION.RESIDENT_UPDATED,
            actionCategory: 'UPDATE',
            module: RESIDENTS_MODULE,
            entityType: 'Resident',
            entityId: id,
            beforeState: before,
            afterState: updated,
            result: 'SUCCESS',
          },
          tx,
        );
      });
    } catch (err) {
      // The active-resident pre-check above misses collisions against a
      // soft-deleted unit, which the @@unique([condominiumId, unitNumber])
      // constraint still rejects. Resident has a single unique constraint, so
      // any P2002 here is a unit-number collision — and it can only fire when
      // dto.unitNumber was being written, so it is defined.
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(
          `Unit ${dto.unitNumber} already has an active resident`,
        );
      }
      throw err;
    }

    return this.findOne(condominiumId, id);
  }

  async remove(condominiumId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.resident.findFirst({
        where: { id, condominiumId, deletedAt: null },
        include: RESIDENT_INCLUDE,
      });
      if (!before) throw new NotFoundException('Resident not found');

      const deleted = await tx.resident.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.RESIDENT_DELETED,
          actionCategory: 'DELETE',
          module: RESIDENTS_MODULE,
          entityType: 'Resident',
          entityId: id,
          beforeState: before,
          result: 'SUCCESS',
        },
        tx,
      );

      return deleted;
    });
  }

  async addVehicle(
    condominiumId: string,
    userId: string,
    residentId: string,
    dto: CreateVehicleDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const vehicle = await tx.vehicle.create({
        data: this.toVehicleCreateData(condominiumId, residentId, dto),
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.VEHICLE_ADDED,
          actionCategory: 'CREATE',
          module: RESIDENTS_MODULE,
          entityType: 'Vehicle',
          entityId: vehicle.id,
          afterState: vehicle,
          result: 'SUCCESS',
        },
        tx,
      );

      return vehicle;
    });
  }

  async updateVehicle(
    condominiumId: string,
    userId: string,
    residentId: string,
    vehicleId: string,
    dto: UpdateVehicleDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const before = await tx.vehicle.findFirst({
        where: { id: vehicleId, residentId, condominiumId },
      });
      if (!before) throw new NotFoundException('Vehicle not found');

      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: this.toVehicleUpdateData(dto),
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.VEHICLE_UPDATED,
          actionCategory: 'UPDATE',
          module: RESIDENTS_MODULE,
          entityType: 'Vehicle',
          entityId: vehicleId,
          beforeState: before,
          afterState: updated,
          result: 'SUCCESS',
        },
        tx,
      );

      return updated;
    });
  }

  async removeVehicle(
    condominiumId: string,
    userId: string,
    residentId: string,
    vehicleId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const before = await tx.vehicle.findFirst({
        where: { id: vehicleId, residentId, condominiumId },
      });
      if (!before) throw new NotFoundException('Vehicle not found');

      const deleted = await tx.vehicle.delete({ where: { id: vehicleId } });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.VEHICLE_REMOVED,
          actionCategory: 'DELETE',
          module: RESIDENTS_MODULE,
          entityType: 'Vehicle',
          entityId: vehicleId,
          beforeState: before,
          result: 'SUCCESS',
        },
        tx,
      );

      return deleted;
    });
  }

  async addPet(
    condominiumId: string,
    userId: string,
    residentId: string,
    dto: CreatePetDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const pet = await tx.pet.create({
        data: this.toPetCreateData(residentId, dto),
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.PET_ADDED,
          actionCategory: 'CREATE',
          module: RESIDENTS_MODULE,
          entityType: 'Pet',
          entityId: pet.id,
          afterState: pet,
          result: 'SUCCESS',
        },
        tx,
      );

      return pet;
    });
  }

  async updatePet(
    condominiumId: string,
    userId: string,
    residentId: string,
    petId: string,
    dto: UpdatePetDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const before = await tx.pet.findFirst({ where: { id: petId, residentId } });
      if (!before) throw new NotFoundException('Pet not found');

      const updated = await tx.pet.update({
        where: { id: petId },
        data: this.toPetUpdateData(dto),
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.PET_UPDATED,
          actionCategory: 'UPDATE',
          module: RESIDENTS_MODULE,
          entityType: 'Pet',
          entityId: petId,
          beforeState: before,
          afterState: updated,
          result: 'SUCCESS',
        },
        tx,
      );

      return updated;
    });
  }

  async removePet(
    condominiumId: string,
    userId: string,
    residentId: string,
    petId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const before = await tx.pet.findFirst({ where: { id: petId, residentId } });
      if (!before) throw new NotFoundException('Pet not found');

      const deleted = await tx.pet.delete({ where: { id: petId } });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.PET_REMOVED,
          actionCategory: 'DELETE',
          module: RESIDENTS_MODULE,
          entityType: 'Pet',
          entityId: petId,
          beforeState: before,
          result: 'SUCCESS',
        },
        tx,
      );

      return deleted;
    });
  }

  // Tenant-isolation gate for vehicle/pet writes: the child entity is only
  // reachable when its resident exists in the caller's condominium.
  private async assertResidentInCondominium(
    tx: Prisma.TransactionClient,
    condominiumId: string,
    residentId: string,
  ) {
    const resident = await tx.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
      select: { id: true },
    });
    if (!resident) throw new NotFoundException('Resident not found');
  }

  private toResidentCreateData(
    condominiumId: string,
    dto: CreateResidentDto,
  ): Prisma.ResidentUncheckedCreateInput {
    return {
      condominiumId,
      unitNumber: dto.unitNumber,
      residentType: dto.residentType,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      secondaryPhone: dto.secondaryPhone,
      email: dto.email,
      monthlyFee: dto.monthlyFee ?? 0,
      parkingSpots: dto.parkingSpots ?? 0,
      notes: dto.notes,
    };
  }

  private toResidentUpdateData(dto: UpdateResidentDto): Prisma.ResidentUpdateInput {
    return {
      unitNumber: dto.unitNumber,
      residentType: dto.residentType,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      secondaryPhone: dto.secondaryPhone,
      email: dto.email,
      monthlyFee: dto.monthlyFee,
      parkingSpots: dto.parkingSpots,
      notes: dto.notes,
    };
  }

  private toVehicleCreateData(
    condominiumId: string,
    residentId: string,
    dto: CreateVehicleDto,
  ): Prisma.VehicleUncheckedCreateInput {
    return {
      condominiumId,
      residentId,
      make: dto.make,
      model: dto.model,
      color: dto.color,
      plates: dto.plates,
      hasTag: dto.hasTag,
      tagId: dto.tagId,
    };
  }

  private toVehicleUpdateData(dto: UpdateVehicleDto): Prisma.VehicleUpdateInput {
    return {
      make: dto.make,
      model: dto.model,
      color: dto.color,
      plates: dto.plates,
      hasTag: dto.hasTag,
      tagId: dto.tagId,
    };
  }

  private toPetCreateData(
    residentId: string,
    dto: CreatePetDto,
  ): Prisma.PetUncheckedCreateInput {
    return {
      residentId,
      name: dto.name,
      petType: dto.petType,
      description: dto.description,
    };
  }

  private toPetUpdateData(dto: UpdatePetDto): Prisma.PetUpdateInput {
    return {
      name: dto.name,
      petType: dto.petType,
      description: dto.description,
    };
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
