import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DossierConfidentiality,
  DossierEventType,
  DossierSeverity,
  DossierStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacService } from '../../common/rbac/rbac.service';
import { AuditService } from '../audit/audit.service';
import { CreateDossierEntryDto } from './dto/create-dossier-entry.dto';
import { ListDossierEntriesDto } from './dto/list-dossier-entries.dto';
import { UpdateDossierEntryDto } from './dto/update-dossier-entry.dto';

const DOSSIER_MODULE = 'resident-dossier';

const AUDIT_ACTION = {
  DOSSIER_CREATED: 'DOSSIER_CREATED',
  DOSSIER_UPDATED: 'DOSSIER_UPDATED',
  DOSSIER_DELETED: 'DOSSIER_DELETED',
  DOSSIER_VIEWED: 'DOSSIER_VIEWED',
  DOSSIER_LIST_VIEWED: 'DOSSIER_LIST_VIEWED',
} as const;

// Maps a dossier view permission to the confidentiality level it unlocks. A
// user sees a record only when they hold the permission for its level. This is
// the permission-based analogue of the calendar's role-based visibility filter.
const LEVEL_PERMISSION: Record<DossierConfidentiality, string> = {
  STANDARD: 'residents.dossier.view',
  RESTRICTED: 'residents.dossier.viewRestricted',
  LEGAL_CONFIDENTIAL: 'residents.dossier.viewLegal',
};

const ENTRY_INCLUDE = {
  events: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ResidentDossierEntryInclude;

@Injectable()
export class ResidentDossierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // The confidentiality levels the user is allowed to see, derived from their
  // effective (live) permissions — never from a hardcoded role name.
  private async allowedLevels(userId: string): Promise<DossierConfidentiality[]> {
    const perms = await this.rbac.getEffectivePermissions(userId);
    return (Object.keys(LEVEL_PERMISSION) as DossierConfidentiality[]).filter(
      (level) => perms.has(LEVEL_PERMISSION[level]),
    );
  }

  // HIGH-severity entries must carry documentary backing (a reference folio in
  // phase 2A; file attachments land in 2B). Enforced against the merged result,
  // since a PATCH may raise severity or clear the folio independently.
  private assertEvidence(severity: DossierSeverity, referenceFolio: string | null) {
    if (severity === DossierSeverity.HIGH && !referenceFolio?.trim()) {
      throw new UnprocessableEntityException('errors.dossier.evidenceRequired');
    }
  }

  // Allow-listed Prisma payload — the DTO is never spread into `data:` so a
  // request body can never write condominiumId/residentId/createdBy/deletedAt.
  private toEntryData(dto: CreateDossierEntryDto | UpdateDossierEntryDto) {
    return {
      category: dto.category,
      severity: dto.severity,
      status: dto.status,
      confidentiality: dto.confidentiality,
      title: dto.title,
      description: dto.description,
      referenceFolio: dto.referenceFolio,
      amount: dto.amount,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
      resolvedAt:
        dto.resolvedAt === undefined ? undefined : dto.resolvedAt ? new Date(dto.resolvedAt) : null,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    };
  }

  private async assertResident(condominiumId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
      select: { id: true },
    });
    if (!resident) throw new NotFoundException('Resident not found');
  }

  async findAll(
    condominiumId: string,
    residentId: string,
    userId: string,
    query: ListDossierEntriesDto = {},
  ) {
    await this.assertResident(condominiumId, residentId);
    const levels = await this.allowedLevels(userId);

    // View auditing — sensitive data: record who listed whose dossier.
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.DOSSIER_LIST_VIEWED,
      actionCategory: 'READ',
      module: DOSSIER_MODULE,
      entityType: 'Resident',
      entityId: residentId,
      result: 'SUCCESS',
    });

    const where: Prisma.ResidentDossierEntryWhereInput = {
      condominiumId,
      residentId,
      deletedAt: null,
      confidentiality: { in: levels },
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    return this.prisma.residentDossierEntry.findMany({
      where,
      include: ENTRY_INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(
    condominiumId: string,
    residentId: string,
    entryId: string,
    userId: string,
  ) {
    const entry = await this.prisma.residentDossierEntry.findFirst({
      where: { id: entryId, condominiumId, residentId, deletedAt: null },
      include: ENTRY_INCLUDE,
    });
    if (!entry) throw new NotFoundException('Dossier entry not found');

    const levels = await this.allowedLevels(userId);
    if (!levels.includes(entry.confidentiality)) {
      // The caller may see the resident but not this confidentiality tier.
      throw new ForbiddenException('errors.dossier.forbiddenLevel');
    }

    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.DOSSIER_VIEWED,
      actionCategory: 'READ',
      module: DOSSIER_MODULE,
      entityType: 'ResidentDossierEntry',
      entityId: entry.id,
      result: 'SUCCESS',
    });

    return entry;
  }

  async create(
    condominiumId: string,
    residentId: string,
    userId: string,
    dto: CreateDossierEntryDto,
  ) {
    await this.assertResident(condominiumId, residentId);
    const severity = (dto.severity ?? DossierSeverity.LOW) as DossierSeverity;
    this.assertEvidence(severity, dto.referenceFolio ?? null);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.residentDossierEntry.create({
        data: {
          ...this.toEntryData(dto),
          category: dto.category,
          title: dto.title,
          description: dto.description,
          occurredAt: new Date(dto.occurredAt),
          condominiumId,
          residentId,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await tx.dossierEvent.create({
        data: {
          condominiumId,
          dossierEntryId: created.id,
          type: DossierEventType.CREATED,
          toStatus: created.status,
          createdBy: userId,
        },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.DOSSIER_CREATED,
          actionCategory: 'CREATE',
          module: DOSSIER_MODULE,
          entityType: 'ResidentDossierEntry',
          entityId: created.id,
          afterState: created,
          result: 'SUCCESS',
        },
        tx,
      );

      return tx.residentDossierEntry.findFirst({
        where: { id: created.id },
        include: ENTRY_INCLUDE,
      });
    });
  }

  async update(
    condominiumId: string,
    residentId: string,
    entryId: string,
    userId: string,
    dto: UpdateDossierEntryDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.residentDossierEntry.findFirst({
        where: { id: entryId, condominiumId, residentId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Dossier entry not found');

      const nextSeverity = (dto.severity ?? before.severity) as DossierSeverity;
      const nextFolio =
        dto.referenceFolio !== undefined ? dto.referenceFolio : before.referenceFolio;
      this.assertEvidence(nextSeverity, nextFolio ?? null);

      const result = await tx.residentDossierEntry.updateMany({
        where: { id: entryId, condominiumId, residentId, deletedAt: null },
        data: { ...this.toEntryData(dto), updatedBy: userId },
      });
      if (result.count === 0) throw new NotFoundException('Dossier entry not found');

      const nextStatus = (dto.status ?? before.status) as DossierStatus;
      const statusChanged = nextStatus !== before.status;
      await tx.dossierEvent.create({
        data: {
          condominiumId,
          dossierEntryId: entryId,
          type: statusChanged ? DossierEventType.STATUS_CHANGED : DossierEventType.UPDATED,
          fromStatus: statusChanged ? before.status : null,
          toStatus: statusChanged ? nextStatus : null,
          createdBy: userId,
        },
      });

      const updated = await tx.residentDossierEntry.findFirst({
        where: { id: entryId },
        include: ENTRY_INCLUDE,
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.DOSSIER_UPDATED,
          actionCategory: 'UPDATE',
          module: DOSSIER_MODULE,
          entityType: 'ResidentDossierEntry',
          entityId: entryId,
          beforeState: before,
          afterState: updated,
          result: 'SUCCESS',
        },
        tx,
      );

      return updated;
    });
  }

  async remove(
    condominiumId: string,
    residentId: string,
    entryId: string,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.residentDossierEntry.findFirst({
        where: { id: entryId, condominiumId, residentId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Dossier entry not found');

      // Soft delete — sensitive legal records are retained for forensic recovery;
      // reads filter `deletedAt` out across the service.
      const result = await tx.residentDossierEntry.updateMany({
        where: { id: entryId, condominiumId, residentId, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: userId },
      });
      if (result.count === 0) throw new NotFoundException('Dossier entry not found');

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.DOSSIER_DELETED,
          actionCategory: 'DELETE',
          module: DOSSIER_MODULE,
          entityType: 'ResidentDossierEntry',
          entityId: entryId,
          beforeState: before,
          afterState: null,
          result: 'SUCCESS',
        },
        tx,
      );

      return { id: entryId, deleted: true };
    });
  }
}
