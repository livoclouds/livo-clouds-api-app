import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateVisitorLogDto } from './dto/create-visitor-log.dto';
import { UpdateVisitorLogDto } from './dto/update-visitor-log.dto';
import { ListVisitorLogsDto } from './dto/list-visitor-logs.dto';

const SECURITY_MODULE = 'security';

const AUDIT_ACTION = {
  VISITOR_CHECKED_IN: 'VISITOR_CHECKED_IN',
  VISITOR_UPDATED: 'VISITOR_UPDATED',
  VISITOR_CHECKED_OUT: 'VISITOR_CHECKED_OUT',
  VISITOR_DELETED: 'VISITOR_DELETED',
} as const;

// Resident summary surfaced with each visit so the gate UI can show who is
// being visited without a second round-trip.
const RESIDENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  unitNumber: true,
} as const;

@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAllVisitors(
    condominiumId: string,
    query: ListVisitorLogsDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.VisitorLogWhereInput = {
      condominiumId,
      deletedAt: null,
      ...(query.visitorName
        ? { visitorName: { contains: query.visitorName, mode: 'insensitive' } }
        : {}),
      ...(query.unit
        ? { unit: { contains: query.unit, mode: 'insensitive' } }
        : {}),
      ...(query.status === 'active'
        ? { checkOutAt: null }
        : query.status === 'completed'
          ? { checkOutAt: { not: null } }
          : {}),
    };

    const sortBy = query.sortBy ?? 'checkInAt';
    const sortDirection = query.sortDirection ?? 'desc';
    const orderBy: Prisma.VisitorLogOrderByWithRelationInput = {
      [sortBy]: sortDirection,
    };

    const [data, total] = await Promise.all([
      this.prisma.visitorLog.findMany({
        where,
        include: { resident: { select: RESIDENT_SELECT } },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.visitorLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async createVisitor(
    condominiumId: string,
    userId: string,
    dto: CreateVisitorLogDto,
  ) {
    await this.assertResidentInCondo(condominiumId, dto.residentId);

    const created = await this.prisma.visitorLog.create({
      data: {
        condominiumId,
        residentId: dto.residentId ?? null,
        visitorName: dto.visitorName,
        unit: dto.unit,
        plate: dto.plate,
        notes: dto.notes,
        checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : undefined,
        createdBy: userId,
        updatedBy: userId,
      },
      include: { resident: { select: RESIDENT_SELECT } },
    });

    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.VISITOR_CHECKED_IN,
      actionCategory: 'CREATE',
      module: SECURITY_MODULE,
      entityType: 'VisitorLog',
      entityId: created.id,
      afterState: { visitorName: created.visitorName, unit: created.unit },
    });

    return created;
  }

  async updateVisitor(
    condominiumId: string,
    userId: string,
    id: string,
    dto: UpdateVisitorLogDto,
  ) {
    const existing = await this.prisma.visitorLog.findFirst({
      where: { id, condominiumId, deletedAt: null },
      select: { id: true, checkOutAt: true },
    });
    if (!existing) throw new NotFoundException('Visitor log not found');

    if (dto.residentId !== undefined) {
      await this.assertResidentInCondo(condominiumId, dto.residentId);
    }

    // Allow-listed write payload — the request body is never spread into Prisma.
    // `undefined` leaves a column unchanged; checkOutAt accepts an explicit null.
    const data: Prisma.VisitorLogUpdateInput = {
      visitorName: dto.visitorName,
      unit: dto.unit,
      plate: dto.plate,
      notes: dto.notes,
      checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : undefined,
      updatedBy: userId,
    };
    if (dto.residentId !== undefined) {
      data.resident = dto.residentId
        ? { connect: { id: dto.residentId } }
        : { disconnect: true };
    }
    if (dto.checkOutAt !== undefined) {
      data.checkOutAt = dto.checkOutAt ? new Date(dto.checkOutAt) : null;
    }

    const updated = await this.prisma.visitorLog.update({
      where: { id },
      data,
      include: { resident: { select: RESIDENT_SELECT } },
    });

    // A first-time check-out is the meaningful event; otherwise it's an edit.
    const isCheckOut =
      dto.checkOutAt != null && existing.checkOutAt === null;
    await this.audit.log({
      condominiumId,
      userId,
      action: isCheckOut
        ? AUDIT_ACTION.VISITOR_CHECKED_OUT
        : AUDIT_ACTION.VISITOR_UPDATED,
      actionCategory: 'UPDATE',
      module: SECURITY_MODULE,
      entityType: 'VisitorLog',
      entityId: id,
    });

    return updated;
  }

  async removeVisitor(condominiumId: string, userId: string, id: string) {
    const result = await this.prisma.visitorLog.updateMany({
      where: { id, condominiumId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    if (result.count === 0) throw new NotFoundException('Visitor log not found');

    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.VISITOR_DELETED,
      actionCategory: 'DELETE',
      module: SECURITY_MODULE,
      entityType: 'VisitorLog',
      entityId: id,
    });

    return { id, deleted: true };
  }

  // Guards the optional resident link: a provided residentId must belong to the
  // same condominium (tenant isolation) and not be soft-deleted.
  private async assertResidentInCondo(
    condominiumId: string,
    residentId?: string,
  ): Promise<void> {
    if (!residentId) return;
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
      select: { id: true },
    });
    if (!resident) {
      throw new BadRequestException('Resident not found in this condominium');
    }
  }
}
