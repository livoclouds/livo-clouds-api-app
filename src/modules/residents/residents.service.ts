import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/types';
import { AuditService } from '../audit/audit.service';
import { CreateAdditionalResidentDto } from './dto/create-additional-resident.dto';
import { CreatePetDto } from './dto/create-pet.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListResidentsDto } from './dto/list-residents.dto';
import { UpdateAdditionalResidentDto } from './dto/update-additional-resident.dto';
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
  ADDITIONAL_RESIDENT_ADDED: 'RESIDENT_ADDITIONAL_RESIDENT_ADDED',
  ADDITIONAL_RESIDENT_UPDATED: 'RESIDENT_ADDITIONAL_RESIDENT_UPDATED',
  ADDITIONAL_RESIDENT_REMOVED: 'RESIDENT_ADDITIONAL_RESIDENT_REMOVED',
} as const;

const RESIDENT_INCLUDE = {
  vehicles: true,
  pets: true,
  additionalResidents: true,
} satisfies Prisma.ResidentInclude;

// The five boolean flags stored in Resident.documentation. Used to build the
// JSON-path where clause for the complete / incomplete documentation filter.
const DOCUMENTATION_KEYS = [
  'propertyTax',
  'titleDeed',
  'ownerDocumentation',
  'nationalId',
  'proofOfAddress',
] as const;

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

    const where = buildResidentWhere(condominiumId, dto);
    const orderBy = buildResidentOrderBy(dto);

    // Fetch the condominium's fee/currency settings alongside the page so the
    // residents list response carries them inline (meta.condominium). This lets
    // the web client load the residents page with a single authenticated call
    // instead of a second sequential /settings fetch — see the web getResidents
    // comment. Defaults mirror the web fallbacks (0 / 0 / MXN) when no settings
    // row exists yet, so the list still renders for a freshly-created tenant.
    const [data, total, settings] = await Promise.all([
      this.prisma.resident.findMany({
        where,
        include: RESIDENT_INCLUDE,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.resident.count({ where }),
      this.prisma.condominiumSettings.findUnique({
        where: { condominiumId },
        select: { ordinaryFeeAmount: true, lateFeeAmount: true, currency: true },
      }),
    ]);

    const enriched = await this.attachLastModifiedBy(data);

    return {
      data: enriched,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        condominium: {
          ordinaryFeeAmount: (settings?.ordinaryFeeAmount ?? 0).toString(),
          lateFeeAmount: (settings?.lateFeeAmount ?? 0).toString(),
          currency: settings?.currency ?? 'MXN',
        },
      },
    };
  }

  // Adds `lastModifiedByName` (display name of the last actor) to each resident,
  // derived from the audit trail — the single source of truth, since Resident
  // has no `updatedBy` column. One query for the whole page; the most recent
  // RESIDENT_CREATED/UPDATED row per resident wins, so a never-edited resident
  // still shows its creator. Null when no audit row exists (e.g. legacy data).
  private async attachLastModifiedBy<T extends { id: string }>(
    residents: T[],
  ): Promise<(T & { lastModifiedByName: string | null })[]> {
    if (residents.length === 0) return [];

    const ids = residents.map((r) => r.id);
    const audits = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'Resident',
        entityId: { in: ids },
        action: {
          in: [AUDIT_ACTION.RESIDENT_CREATED, AUDIT_ACTION.RESIDENT_UPDATED],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        entityId: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });

    // orderBy desc → the first row seen per entityId is the most recent.
    const byId = new Map<string, string>();
    for (const a of audits) {
      if (!a.entityId || byId.has(a.entityId)) continue;
      byId.set(a.entityId, `${a.user.firstName} ${a.user.lastName}`.trim());
    }

    return residents.map((r) => ({
      ...r,
      lastModifiedByName: byId.get(r.id) ?? null,
    }));
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

  // Soft-deletes several residents in a single transaction, writing one
  // RESIDENT_DELETED audit row per resident (same shape as `remove`). IDs that
  // are not found / already deleted in this condominium are skipped rather than
  // aborting the batch, so a stale selection never fails the whole request.
  // Returns how many were actually deleted vs. requested.
  async removeMany(condominiumId: string, userId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];

    return this.prisma.$transaction(async (tx) => {
      const targets = await tx.resident.findMany({
        where: { id: { in: uniqueIds }, condominiumId, deletedAt: null },
        include: RESIDENT_INCLUDE,
      });

      const now = new Date();
      for (const before of targets) {
        await tx.resident.update({
          where: { id: before.id },
          data: { deletedAt: now },
        });

        await this.audit.log(
          {
            condominiumId,
            userId,
            action: AUDIT_ACTION.RESIDENT_DELETED,
            actionCategory: 'DELETE',
            module: RESIDENTS_MODULE,
            entityType: 'Resident',
            entityId: before.id,
            beforeState: before,
            result: 'SUCCESS',
          },
          tx,
        );
      }

      return { deleted: targets.length, requested: uniqueIds.length };
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
        data: this.toPetCreateData(condominiumId, residentId, dto),
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

      const before = await tx.pet.findFirst({
        where: { id: petId, residentId, condominiumId },
      });
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

      const before = await tx.pet.findFirst({
        where: { id: petId, residentId, condominiumId },
      });
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

  async addAdditionalResident(
    condominiumId: string,
    userId: string,
    residentId: string,
    dto: CreateAdditionalResidentDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const additionalResident = await tx.additionalResident.create({
        data: this.toAdditionalResidentCreateData(residentId, dto),
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.ADDITIONAL_RESIDENT_ADDED,
          actionCategory: 'CREATE',
          module: RESIDENTS_MODULE,
          entityType: 'AdditionalResident',
          entityId: additionalResident.id,
          afterState: additionalResident,
          result: 'SUCCESS',
        },
        tx,
      );

      return additionalResident;
    });
  }

  async updateAdditionalResident(
    condominiumId: string,
    userId: string,
    residentId: string,
    additionalResidentId: string,
    dto: UpdateAdditionalResidentDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const before = await tx.additionalResident.findFirst({
        where: { id: additionalResidentId, residentId },
      });
      if (!before) throw new NotFoundException('Additional resident not found');

      const updated = await tx.additionalResident.update({
        where: { id: additionalResidentId },
        data: this.toAdditionalResidentUpdateData(dto),
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.ADDITIONAL_RESIDENT_UPDATED,
          actionCategory: 'UPDATE',
          module: RESIDENTS_MODULE,
          entityType: 'AdditionalResident',
          entityId: additionalResidentId,
          beforeState: before,
          afterState: updated,
          result: 'SUCCESS',
        },
        tx,
      );

      return updated;
    });
  }

  async removeAdditionalResident(
    condominiumId: string,
    userId: string,
    residentId: string,
    additionalResidentId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertResidentInCondominium(tx, condominiumId, residentId);

      const before = await tx.additionalResident.findFirst({
        where: { id: additionalResidentId, residentId },
      });
      if (!before) throw new NotFoundException('Additional resident not found');

      const deleted = await tx.additionalResident.delete({
        where: { id: additionalResidentId },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.ADDITIONAL_RESIDENT_REMOVED,
          actionCategory: 'DELETE',
          module: RESIDENTS_MODULE,
          entityType: 'AdditionalResident',
          entityId: additionalResidentId,
          beforeState: before,
          result: 'SUCCESS',
        },
        tx,
      );

      return deleted;
    });
  }

  // Tenant-isolation gate for vehicle/pet/additional-resident writes: the child
  // entity is only reachable when its resident exists in the caller's
  // condominium. AdditionalResident has no condominiumId column, so this parent
  // check is its only isolation boundary.
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
      paymentStatus: dto.paymentStatus,
      // Map the documentation flags field-by-field into a plain object so the
      // value is a clean Prisma.InputJsonValue (not a class instance) and no
      // unexpected key can reach the Json column. `undefined` when absent so
      // Prisma leaves the existing column untouched.
      documentation: dto.documentation
        ? {
            propertyTax: dto.documentation.propertyTax,
            titleDeed: dto.documentation.titleDeed,
            ownerDocumentation: dto.documentation.ownerDocumentation,
            nationalId: dto.documentation.nationalId,
            proofOfAddress: dto.documentation.proofOfAddress,
          }
        : undefined,
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
    condominiumId: string,
    residentId: string,
    dto: CreatePetDto,
  ): Prisma.PetUncheckedCreateInput {
    return {
      condominiumId,
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

  private toAdditionalResidentCreateData(
    residentId: string,
    dto: CreateAdditionalResidentDto,
  ): Prisma.AdditionalResidentUncheckedCreateInput {
    return {
      residentId,
      name: dto.name,
      residentType: dto.residentType,
      phone: dto.phone,
      secondaryPhone: dto.secondaryPhone,
      email: dto.email,
      relationship: dto.relationship,
    };
  }

  private toAdditionalResidentUpdateData(
    dto: UpdateAdditionalResidentDto,
  ): Prisma.AdditionalResidentUpdateInput {
    return {
      name: dto.name,
      residentType: dto.residentType,
      phone: dto.phone,
      secondaryPhone: dto.secondaryPhone,
      email: dto.email,
      relationship: dto.relationship,
    };
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

// Builds the Prisma where clause for the residents list. Every filter dimension
// surfaced by the web table is translated to an indexed/database-level
// condition — no row is ever loaded into memory to be filtered out. Tenant
// isolation (condominiumId + deletedAt) is always applied and never derived
// from request input.
// Splits a free-text search into non-empty, whitespace-delimited tokens.
function tokenize(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function buildResidentWhere(
  condominiumId: string,
  dto: ListResidentsDto,
): Prisma.ResidentWhereInput {
  const and: Prisma.ResidentWhereInput[] = [];

  // Tokenize multi-word input: each whitespace-separated word must match (AND),
  // and a word matches when it is a substring of any searchable column (OR).
  // This is what makes "Jose Omar Barron Elias" match firstName="Jose Omar" +
  // lastName="Barron Elias" — a single `contains` on the whole string never
  // matches because no one column holds every word.
  if (dto.q) {
    for (const tok of tokenize(dto.q)) {
      and.push({
        OR: [
          { unitNumber: { contains: tok, mode: 'insensitive' } },
          { firstName: { contains: tok, mode: 'insensitive' } },
          { lastName: { contains: tok, mode: 'insensitive' } },
        ],
      });
    }
  }

  if (dto.unitNumber) {
    and.push(
      dto.unitExact
        ? { unitNumber: { equals: dto.unitNumber, mode: 'insensitive' } }
        : { unitNumber: { contains: dto.unitNumber, mode: 'insensitive' } },
    );
  }

  if (dto.name) {
    for (const tok of tokenize(dto.name)) {
      and.push({
        OR: [
          { firstName: { contains: tok, mode: 'insensitive' } },
          { lastName: { contains: tok, mode: 'insensitive' } },
        ],
      });
    }
  }

  if (dto.phone) {
    and.push({
      OR: [
        { phone: { contains: dto.phone, mode: 'insensitive' } },
        { secondaryPhone: { contains: dto.phone, mode: 'insensitive' } },
      ],
    });
  }

  if (dto.email) {
    and.push({ email: { contains: dto.email, mode: 'insensitive' } });
  }

  if (dto.residentType) and.push({ residentType: dto.residentType });
  if (dto.paymentStatus) and.push({ paymentStatus: dto.paymentStatus });
  if (dto.minDebt !== undefined) and.push({ debt: { gte: dto.minDebt } });

  if (dto.dateFrom || dto.dateTo) {
    const updatedAt: Prisma.DateTimeFilter = {};
    if (dto.dateFrom) updatedAt.gte = dayStartUtc(dto.dateFrom);
    if (dto.dateTo) updatedAt.lte = dayEndUtc(dto.dateTo);
    and.push({ updatedAt });
  }

  if (dto.hasVehicles !== undefined) {
    and.push(
      dto.hasVehicles ? { vehicles: { some: {} } } : { vehicles: { none: {} } },
    );
  }

  // hasTag=false also matches residents with no vehicles at all — they own
  // zero tagged vehicles, which is what the "no tag" table filter means.
  if (dto.hasTag !== undefined) {
    and.push(
      dto.hasTag
        ? { vehicles: { some: { hasTag: true } } }
        : { vehicles: { none: { hasTag: true } } },
    );
  }

  if (dto.hasPets !== undefined) {
    and.push(dto.hasPets ? { pets: { some: {} } } : { pets: { none: {} } });
  }

  if (dto.documentation) {
    const allComplete: Prisma.ResidentWhereInput = {
      AND: DOCUMENTATION_KEYS.map((key) => ({
        documentation: { path: [key], equals: true },
      })),
    };
    and.push(
      dto.documentation === 'complete' ? allComplete : { NOT: allComplete },
    );
  }

  return {
    condominiumId,
    deletedAt: null,
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

// Maps the table's sort column to a deterministic Prisma orderBy. `id` is
// always appended as a stable tiebreaker so pagination never skips or repeats
// rows. unitNumber sorts lexicographically (it is a String column); natural
// numeric ordering is a documented Phase 6 follow-up.
function buildResidentOrderBy(
  dto: ListResidentsDto,
): Prisma.ResidentOrderByWithRelationInput[] {
  const dir: Prisma.SortOrder = dto.sortDirection === 'desc' ? 'desc' : 'asc';
  const tiebreaker: Prisma.ResidentOrderByWithRelationInput = { id: 'asc' };

  switch (dto.sortBy) {
    case 'name':
      return [{ lastName: dir }, { firstName: dir }, tiebreaker];
    case 'email':
      return [{ email: dir }, tiebreaker];
    case 'paymentStatus':
      return [{ paymentStatus: dir }, tiebreaker];
    case 'debt':
      return [{ debt: dir }, tiebreaker];
    case 'parkingSpots':
      return [{ parkingSpots: dir }, tiebreaker];
    case 'monthlyFee':
      return [{ monthlyFee: dir }, tiebreaker];
    case 'lastModified':
      return [{ updatedAt: dir }, tiebreaker];
    case 'unitNumber':
    default:
      return [{ unitNumber: dir }, tiebreaker];
  }
}

// ISO date strings from the client are date-only (YYYY-MM-DD). Convert to the
// inclusive UTC day bounds so the updatedAt range covers the whole day.
function dayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
}

function dayEndUtc(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T23:59:59.999Z`);
}
