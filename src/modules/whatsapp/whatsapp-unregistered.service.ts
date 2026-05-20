import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WhatsAppUnregisteredContactStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../../common/types';
import { CreateResidentDto } from '../residents/dto/create-resident.dto';
import { ListUnregisteredDto } from './dto/list-unregistered.dto';
import { UpdateUnregisteredContactDto } from './dto/update-unregistered.dto';

/** Allowed status transitions for manual admin edits. REGISTERED is terminal. */
const STATUS_TRANSITIONS: Record<
  WhatsAppUnregisteredContactStatus,
  WhatsAppUnregisteredContactStatus[]
> = {
  NEW: ['REVIEWED', 'IGNORED'],
  REVIEWED: ['NEW', 'IGNORED'],
  IGNORED: ['NEW', 'REVIEWED'],
  REGISTERED: [],
};

@Injectable()
export class WhatsAppUnregisteredService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async list(condominiumId: string, query: ListUnregisteredDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.WhatsAppUnregisteredContactWhereInput = { condominiumId };
    if (query.status) where.status = query.status;
    if (query.minConversationCount !== undefined) {
      where.conversationCount = { gte: query.minConversationCount };
    }
    if (query.search) {
      where.OR = [
        { phoneNumber: { contains: query.search, mode: 'insensitive' } },
        { capturedName: { contains: query.search, mode: 'insensitive' } },
        { capturedUnitNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.whatsAppUnregisteredContact.count({ where }),
      this.prisma.whatsAppUnregisteredContact.findMany({
        where,
        orderBy: [{ lastSeenAt: 'desc' }],
        skip,
        take: pageSize,
      }),
    ]);

    return {
      data,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getOne(condominiumId: string, id: string) {
    const contact = await this.prisma.whatsAppUnregisteredContact.findFirst({
      where: { id, condominiumId },
    });
    if (!contact) throw new NotFoundException('Unregistered contact not found');
    return contact;
  }

  async update(
    condominiumId: string,
    id: string,
    dto: UpdateUnregisteredContactDto,
    user: JwtPayload,
  ) {
    const contact = await this.getOne(condominiumId, id);

    if (dto.status && dto.status !== contact.status) {
      const allowed = STATUS_TRANSITIONS[contact.status];
      if (!allowed.includes(dto.status)) {
        throw new ConflictException(
          `Cannot change status from ${contact.status} to ${dto.status}`,
        );
      }
    }

    const data: Prisma.WhatsAppUnregisteredContactUpdateInput = {};
    if (dto.capturedUnitNumber !== undefined) {
      data.capturedUnitNumber = dto.capturedUnitNumber.trim() || null;
    }
    if (dto.capturedName !== undefined) {
      data.capturedName = dto.capturedName.trim() || null;
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes.trim() || null;
    }
    if (dto.status) {
      data.status = dto.status;
    }

    const updated = await this.prisma.whatsAppUnregisteredContact.update({
      where: { id: contact.id },
      data,
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_UNREGISTERED_UPDATED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppUnregisteredContact',
      entityId: contact.id,
      beforeState: {
        capturedUnitNumber: contact.capturedUnitNumber,
        capturedName: contact.capturedName,
        status: contact.status,
      },
      afterState: {
        capturedUnitNumber: updated.capturedUnitNumber,
        capturedName: updated.capturedName,
        status: updated.status,
      },
      result: 'SUCCESS',
      description: 'Unregistered contact updated',
    });

    return updated;
  }

  async registerAsResident(
    condominiumId: string,
    id: string,
    dto: CreateResidentDto,
    user: JwtPayload,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const contact = await tx.whatsAppUnregisteredContact.findFirst({
        where: { id, condominiumId },
      });
      if (!contact) throw new NotFoundException('Unregistered contact not found');
      if (contact.status === 'REGISTERED') {
        throw new ConflictException('Contact is already registered');
      }

      const occupied = await tx.resident.findFirst({
        where: { condominiumId, unitNumber: dto.unitNumber, deletedAt: null },
      });
      if (occupied) {
        throw new ConflictException(
          `Unit ${dto.unitNumber} already has an active resident`,
        );
      }

      const resident = await tx.resident.create({
        data: {
          condominiumId,
          unitNumber: dto.unitNumber,
          residentType: dto.residentType,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone ?? contact.phoneNumber,
          secondaryPhone: dto.secondaryPhone,
          email: dto.email,
          monthlyFee: dto.monthlyFee ?? 0,
          parkingSpots: dto.parkingSpots ?? 0,
          notes: dto.notes,
        },
      });

      const relinked = await tx.whatsAppConversation.updateMany({
        where: { unregisteredContactId: contact.id },
        data: {
          residentId: resident.id,
          unregisteredContactId: null,
          contactName: `${resident.firstName} ${resident.lastName}`.trim(),
        },
      });

      await tx.whatsAppUnregisteredContact.update({
        where: { id: contact.id },
        data: { status: 'REGISTERED', registeredResidentId: resident.id },
      });

      return { resident, conversationsRelinked: relinked.count, contact };
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_UNREGISTERED_PROMOTED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppUnregisteredContact',
      entityId: result.contact.id,
      beforeState: {
        status: result.contact.status,
        capturedUnitNumber: result.contact.capturedUnitNumber,
        capturedName: result.contact.capturedName,
      },
      afterState: {
        residentId: result.resident.id,
        conversationsRelinked: result.conversationsRelinked,
      },
      result: 'SUCCESS',
      description: 'Unregistered contact promoted to resident',
    });

    return {
      resident: result.resident,
      conversationsRelinked: result.conversationsRelinked,
    };
  }

  async ignore(condominiumId: string, id: string, user: JwtPayload) {
    const contact = await this.getOne(condominiumId, id);
    if (contact.status === 'REGISTERED') {
      throw new ConflictException('Cannot ignore a registered contact');
    }

    const updated = await this.prisma.whatsAppUnregisteredContact.update({
      where: { id: contact.id },
      data: { status: 'IGNORED' },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_UNREGISTERED_IGNORED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppUnregisteredContact',
      entityId: contact.id,
      beforeState: { status: contact.status },
      afterState: { status: 'IGNORED' },
      result: 'SUCCESS',
      description: 'Unregistered contact marked as ignored',
    });

    return updated;
  }
}
