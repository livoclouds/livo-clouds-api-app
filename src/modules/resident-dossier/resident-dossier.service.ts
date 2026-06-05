import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
// archiver v7 ships CommonJS (`export =`); under this repo's tsconfig
// (esModuleInterop off) a default import compiles but breaks at runtime, so the
// CJS import-equals form is the correct one here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import archiver = require('archiver');
import {
  DossierConfidentiality,
  DossierEventType,
  DossierSeverity,
  DossierStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacService } from '../../common/rbac/rbac.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CollectionService } from '../collection/collection.service';
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
  DOSSIER_NOTE_ADDED: 'DOSSIER_NOTE_ADDED',
  DOSSIER_ATTACHMENT_ADDED: 'DOSSIER_ATTACHMENT_ADDED',
  DOSSIER_ATTACHMENT_REMOVED: 'DOSSIER_ATTACHMENT_REMOVED',
  DOSSIER_EXPORT_REQUESTED: 'DOSSIER_EXPORT_REQUESTED',
  DOSSIER_HARD_DELETED: 'DOSSIER_HARD_DELETED',
  DOSSIER_ARCO_EXPORTED: 'DOSSIER_ARCO_EXPORTED',
} as const;

const MANAGE_PERMISSION = 'residents.dossier.manage';

// Maps a dossier view permission to the confidentiality level it unlocks. A
// user sees a record only when they hold the permission for its level.
const LEVEL_PERMISSION: Record<DossierConfidentiality, string> = {
  STANDARD: 'residents.dossier.view',
  RESTRICTED: 'residents.dossier.viewRestricted',
  LEGAL_CONFIDENTIAL: 'residents.dossier.viewLegal',
};

// Evidence attachments — PDF + images, 10 MB/file (under the API's 20 MB global
// multipart cap, which stays as a backstop).
const ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// `storageKey` is internal (R2 path) and must NEVER leave the API — views go
// through a presigned GET. The list/detail include therefore selects only
// attachment metadata.
const ENTRY_INCLUDE = {
  events: { orderBy: { createdAt: 'asc' as const } },
  attachments: {
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      fileSizeBytes: true,
      uploadedAt: true,
    },
    orderBy: { uploadedAt: 'asc' as const },
  },
} satisfies Prisma.ResidentDossierEntryInclude;

export interface UploadedDossierFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class ResidentDossierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly storage: StorageService,
    private readonly collection: CollectionService,
  ) {}

  // The confidentiality levels the user is allowed to see, derived from their
  // effective (live) permissions — never from a hardcoded role name.
  private async allowedLevels(userId: string): Promise<DossierConfidentiality[]> {
    const perms = await this.rbac.getEffectivePermissions(userId);
    return (Object.keys(LEVEL_PERMISSION) as DossierConfidentiality[]).filter(
      (level) => perms.has(LEVEL_PERMISSION[level]),
    );
  }

  // HIGH-severity entries must carry documentary backing — a reference folio OR
  // at least one evidence attachment. Enforced against the merged result.
  private assertEvidence(
    severity: DossierSeverity,
    referenceFolio: string | null,
    attachmentCount: number,
  ) {
    if (
      severity === DossierSeverity.HIGH &&
      !referenceFolio?.trim() &&
      attachmentCount === 0
    ) {
      throw new UnprocessableEntityException('errors.dossier.evidenceRequired');
    }
  }

  private validateFile(file: UploadedDossierFile) {
    if (!ALLOWED_MIME.includes(file.mimeType)) {
      throw new BadRequestException('errors.dossier.invalidFileType');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('errors.dossier.fileTooLarge');
    }
  }

  private sanitizeFileName(name: string): string {
    const cleaned = (name || 'file')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    return cleaned.slice(-120) || 'file';
  }

  // Uploads one file to R2 and persists its metadata row. The R2 key carries a
  // random segment so two files with the same name never collide, and the key is
  // never derived from client input alone.
  private async storeAttachment(
    condominiumId: string,
    dossierEntryId: string,
    userId: string,
    file: UploadedDossierFile,
  ) {
    this.validateFile(file);
    const key = `condominiums/${condominiumId}/resident-dossier/${dossierEntryId}/${randomUUID()}-${this.sanitizeFileName(
      file.originalName,
    )}`;
    await this.storage.uploadFile(key, file.buffer, file.mimeType, {
      userId,
      condominiumId,
      byteSize: file.size,
    });
    return this.prisma.dossierAttachment.create({
      data: {
        condominiumId,
        dossierEntryId,
        fileName: file.originalName.slice(0, 512),
        storageKey: key,
        mimeType: file.mimeType,
        fileSizeBytes: file.size,
        uploadedBy: userId,
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        fileSizeBytes: true,
        uploadedAt: true,
      },
    });
  }

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

  private async loadEntryOrFail(
    condominiumId: string,
    residentId: string,
    entryId: string,
  ) {
    const entry = await this.prisma.residentDossierEntry.findFirst({
      where: { id: entryId, condominiumId, residentId, deletedAt: null },
    });
    if (!entry) throw new NotFoundException('Dossier entry not found');
    return entry;
  }

  async findAll(
    condominiumId: string,
    residentId: string,
    userId: string,
    query: ListDossierEntriesDto = {},
  ) {
    await this.assertResident(condominiumId, residentId);
    const perms = await this.rbac.getEffectivePermissions(userId);
    const levels = (Object.keys(LEVEL_PERMISSION) as DossierConfidentiality[]).filter(
      (level) => perms.has(LEVEL_PERMISSION[level]),
    );

    // The recycle bin (soft-deleted entries) is a management surface — only
    // `manage` may list it. Live entries stay open to any view tier.
    if (query.deleted && !perms.has(MANAGE_PERMISSION)) {
      throw new ForbiddenException('errors.dossier.forbiddenLevel');
    }

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
      deletedAt: query.deleted ? { not: null } : null,
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
    files: UploadedDossierFile[] = [],
  ) {
    await this.assertResident(condominiumId, residentId);
    const severity = (dto.severity ?? DossierSeverity.LOW) as DossierSeverity;
    files.forEach((f) => this.validateFile(f));
    // Evidence: HIGH needs a folio OR at least one attachment in this request.
    this.assertEvidence(severity, dto.referenceFolio ?? null, files.length);

    // Create the entry + CREATED event + audit atomically; uploads happen after,
    // keyed by the new entry id. An upload failure surfaces to the caller but
    // never leaves the entry without its required folio (the folio path is
    // validated above), so there are no silently-evidence-less HIGH entries.
    const created = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.residentDossierEntry.create({
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
          dossierEntryId: entry.id,
          type: DossierEventType.CREATED,
          toStatus: entry.status,
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
          entityId: entry.id,
          afterState: entry,
          result: 'SUCCESS',
        },
        tx,
      );

      return entry;
    });

    for (const file of files) {
      await this.storeAttachment(condominiumId, created.id, userId, file);
    }

    return this.prisma.residentDossierEntry.findFirst({
      where: { id: created.id },
      include: ENTRY_INCLUDE,
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
      const attachmentCount = await tx.dossierAttachment.count({
        where: { dossierEntryId: entryId },
      });
      this.assertEvidence(nextSeverity, nextFolio ?? null, attachmentCount);

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

  async addNote(
    condominiumId: string,
    residentId: string,
    entryId: string,
    userId: string,
    note: string,
  ) {
    await this.loadEntryOrFail(condominiumId, residentId, entryId);
    await this.prisma.dossierEvent.create({
      data: {
        condominiumId,
        dossierEntryId: entryId,
        type: DossierEventType.NOTE_ADDED,
        note: note.slice(0, 2000),
        createdBy: userId,
      },
    });
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.DOSSIER_NOTE_ADDED,
      actionCategory: 'UPDATE',
      module: DOSSIER_MODULE,
      entityType: 'ResidentDossierEntry',
      entityId: entryId,
      result: 'SUCCESS',
    });
    return this.prisma.residentDossierEntry.findFirst({
      where: { id: entryId },
      include: ENTRY_INCLUDE,
    });
  }

  async addAttachments(
    condominiumId: string,
    residentId: string,
    entryId: string,
    userId: string,
    files: UploadedDossierFile[],
  ) {
    await this.loadEntryOrFail(condominiumId, residentId, entryId);
    if (files.length === 0) {
      throw new BadRequestException('errors.dossier.noFile');
    }
    for (const file of files) {
      await this.storeAttachment(condominiumId, entryId, userId, file);
      await this.prisma.dossierEvent.create({
        data: {
          condominiumId,
          dossierEntryId: entryId,
          type: DossierEventType.ATTACHMENT_ADDED,
          note: file.originalName.slice(0, 2000),
          createdBy: userId,
        },
      });
    }
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.DOSSIER_ATTACHMENT_ADDED,
      actionCategory: 'UPDATE',
      module: DOSSIER_MODULE,
      entityType: 'ResidentDossierEntry',
      entityId: entryId,
      result: 'SUCCESS',
    });
    return this.prisma.residentDossierEntry.findFirst({
      where: { id: entryId },
      include: ENTRY_INCLUDE,
    });
  }

  // Presigned GET for an attachment — gated by the caller's view tier on the
  // parent entry, not just `manage`.
  async getAttachmentUrl(
    condominiumId: string,
    residentId: string,
    entryId: string,
    attachmentId: string,
    userId: string,
  ): Promise<{ url: string }> {
    const entry = await this.loadEntryOrFail(condominiumId, residentId, entryId);
    const levels = await this.allowedLevels(userId);
    if (!levels.includes(entry.confidentiality)) {
      throw new ForbiddenException('errors.dossier.forbiddenLevel');
    }
    const attachment = await this.prisma.dossierAttachment.findFirst({
      where: { id: attachmentId, dossierEntryId: entryId, condominiumId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    const url = await this.storage.getPresignedUrl(attachment.storageKey, 3600, {
      userId,
      condominiumId,
      byteSize: attachment.fileSizeBytes,
    });
    return { url };
  }

  async removeAttachment(
    condominiumId: string,
    residentId: string,
    entryId: string,
    attachmentId: string,
    userId: string,
  ) {
    await this.loadEntryOrFail(condominiumId, residentId, entryId);
    const attachment = await this.prisma.dossierAttachment.findFirst({
      where: { id: attachmentId, dossierEntryId: entryId, condominiumId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    await this.prisma.dossierAttachment.delete({ where: { id: attachment.id } });
    // Best-effort R2 cleanup — a storage hiccup must not fail the API response;
    // the row is already gone and the object becomes orphaned, not leaked.
    await this.storage
      .deleteFile(attachment.storageKey, { condominiumId })
      .catch(() => undefined);

    await this.prisma.dossierEvent.create({
      data: {
        condominiumId,
        dossierEntryId: entryId,
        type: DossierEventType.ATTACHMENT_REMOVED,
        note: attachment.fileName,
        createdBy: userId,
      },
    });
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.DOSSIER_ATTACHMENT_REMOVED,
      actionCategory: 'DELETE',
      module: DOSSIER_MODULE,
      entityType: 'ResidentDossierEntry',
      entityId: entryId,
      result: 'SUCCESS',
    });
    return { id: attachmentId, deleted: true };
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

  // ARCO export — an internal admin tool that bundles a resident's dossier into a
  // ZIP (a structured `dossier.json` + the evidence files). It respects the
  // exporter's confidentiality tier: only entries they could view are included,
  // so an auditor's export carries STANDARD-only. The export itself is audited.
  async exportDossier(
    condominiumId: string,
    residentId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; fileName: string; entries: number; attachments: number }> {
    await this.assertResident(condominiumId, residentId);
    const levels = await this.allowedLevels(userId);

    const entries = await this.prisma.residentDossierEntry.findMany({
      where: {
        condominiumId,
        residentId,
        deletedAt: null,
        confidentiality: { in: levels },
      },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { uploadedAt: 'asc' } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });

    // Manifest mirrors the entries but strips `storageKey` (internal R2 path) —
    // the evidence files travel as real bytes under attachments/, never as keys.
    const manifest = {
      exportedAt: new Date().toISOString(),
      condominiumId,
      residentId,
      tiers: levels,
      entries: entries.map((e) => ({
        ...e,
        attachments: e.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSizeBytes: a.fileSizeBytes,
          uploadedAt: a.uploadedAt,
        })),
      })),
    };

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('warning', (err) => reject(err));
      archive.on('error', (err) => reject(err));
    });

    archive.append(JSON.stringify(manifest, null, 2), { name: 'dossier.json' });

    let attachmentCount = 0;
    for (const entry of entries) {
      for (const att of entry.attachments) {
        const buffer = await this.storage.downloadFile(att.storageKey, {
          userId,
          condominiumId,
          byteSize: att.fileSizeBytes,
        });
        // Prefix with the attachment id so same-named files never collide.
        archive.append(buffer, {
          name: `attachments/${entry.id}/${att.id}-${this.sanitizeFileName(att.fileName)}`,
        });
        attachmentCount += 1;
      }
    }

    await archive.finalize();
    await finished;

    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.DOSSIER_EXPORT_REQUESTED,
      actionCategory: 'READ',
      module: DOSSIER_MODULE,
      entityType: 'Resident',
      entityId: residentId,
      afterState: { entries: entries.length, attachments: attachmentCount, tiers: levels },
      result: 'SUCCESS',
    });

    return {
      buffer: Buffer.concat(chunks),
      fileName: `dossier_${residentId}.zip`,
      entries: entries.length,
      attachments: attachmentCount,
    };
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Cross-module ARCO compilation (Capa 2E) ────────────────────────────────
  // Each method returns a REDACTED projection via an explicit `select` allow-list,
  // so third-party PII can never leak in: counterpart phone/name/message content,
  // visitor identity (name/plate/notes), and raw bank text (description/payerName/
  // unitNumbersDetected) are all excluded by construction, not by post-filtering.

  private async compileFinancials(condominiumId: string, residentId: string) {
    // Reuse the collection account statement for the summary + monthly records —
    // it partitions split payments correctly. Don't reinvent financial logic.
    const statement = await this.collection.getAccountStatement(condominiumId, residentId);
    const allocations = await this.prisma.paymentAllocation.findMany({
      where: { condominiumId, residentId },
      select: {
        paymentPeriodYear: true,
        paymentPeriodMonth: true,
        allocatedAmount: true,
        unitNumber: true,
      },
      orderBy: [{ paymentPeriodYear: 'desc' }, { paymentPeriodMonth: 'desc' }],
    });
    // Redacted transaction projection — amounts/dates/concept only. NEVER
    // `description`, `payerName`, or `unitNumbersDetected` (third party / other units).
    const transactions = await this.prisma.transaction.findMany({
      where: { condominiumId, residentId },
      select: {
        transactionDate: true,
        credits: true,
        charges: true,
        paymentConcept: true,
        paymentPeriodYear: true,
        paymentPeriodMonth: true,
        classificationStatus: true,
      },
      orderBy: { transactionDate: 'desc' },
    });
    return {
      summary: statement.summary,
      collectionRecords: statement.collectionRecords,
      allocations,
      transactions,
    };
  }

  private async compileCommunications(condominiumId: string, residentId: string) {
    // Facts only: dates, status, message count — NO content, NO counterpart
    // phone/name.
    const conversations = await this.prisma.whatsAppConversation.findMany({
      where: { condominiumId, residentId },
      select: {
        createdAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        status: true,
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return conversations.map((c) => ({
      createdAt: c.createdAt,
      lastInboundAt: c.lastInboundAt,
      lastOutboundAt: c.lastOutboundAt,
      status: c.status,
      messageCount: c._count.messages,
    }));
  }

  private async compileVisits(condominiumId: string, residentId: string) {
    // Redacted facts: visit timestamps only — NO visitorName, plate, or notes.
    return this.prisma.visitorLog.findMany({
      where: { condominiumId, residentId, deletedAt: null },
      select: { checkInAt: true, checkOutAt: true },
      orderBy: { checkInAt: 'desc' },
    });
  }

  private async compileCalendar(condominiumId: string, residentId: string) {
    // The subject's own bookings/events — NO `metadata` (may list third-party guests).
    return this.prisma.calendarEvent.findMany({
      where: { condominiumId, residentId },
      select: {
        title: true,
        eventType: true,
        startDate: true,
        endDate: true,
        status: true,
        unitNumber: true,
      },
      orderBy: { startDate: 'desc' },
    });
  }

  // ARCO subject packet (Capa 2D) — a CURATED export of the resident's own
  // personal data for an LFPDPPP "Acceso" request. Distinct from the internal
  // export: it compiles the resident profile + sub-entities (vehicles, pets,
  // additional residents) + their non-legal-confidential dossier, and ships a
  // human-readable HTML cover. LEGAL_CONFIDENTIAL entries are EXCLUDED by
  // exemption, but the packet states how many reserved records exist.
  async exportArcoPacket(
    condominiumId: string,
    residentId: string,
    userId: string,
  ): Promise<{
    buffer: Buffer;
    fileName: string;
    entries: number;
    reservedLegalConfidential: number;
  }> {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
      include: { vehicles: true, pets: true, additionalResidents: true },
    });
    if (!resident) throw new NotFoundException('Resident not found');

    // The subject's own dossier, excluding the legal-confidential tier (exempt).
    const entries = await this.prisma.residentDossierEntry.findMany({
      where: {
        condominiumId,
        residentId,
        deletedAt: null,
        confidentiality: { not: DossierConfidentiality.LEGAL_CONFIDENTIAL },
      },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { uploadedAt: 'asc' } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
    const reservedLegalConfidential = await this.prisma.residentDossierEntry.count({
      where: {
        condominiumId,
        residentId,
        deletedAt: null,
        confidentiality: DossierConfidentiality.LEGAL_CONFIDENTIAL,
      },
    });

    // Cross-module compilation (Capa 2E) — every section is already redacted.
    const [finanzas, comunicaciones, visitas, calendario] = await Promise.all([
      this.compileFinancials(condominiumId, residentId),
      this.compileCommunications(condominiumId, residentId),
      this.compileVisits(condominiumId, residentId),
      this.compileCalendar(condominiumId, residentId),
    ]);

    const redactionNotice =
      'Por protección de datos de terceros se omiten las identidades de contactos ' +
      'y visitantes, el contenido de los mensajes y el texto bancario en bruto; ' +
      'se conservan los hechos (fechas, montos, conteos).';

    const data = {
      generatedAt: new Date().toISOString(),
      condominiumId,
      residentId,
      resident: {
        firstName: resident.firstName,
        lastName: resident.lastName,
        unitNumber: resident.unitNumber,
        residentType: resident.residentType,
        phone: resident.phone,
        email: resident.email,
        documentation: resident.documentation,
        vehicles: resident.vehicles,
        pets: resident.pets,
        additionalResidents: resident.additionalResidents,
      },
      dossier: entries.map((e) => ({
        ...e,
        attachments: e.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSizeBytes: a.fileSizeBytes,
          uploadedAt: a.uploadedAt,
        })),
      })),
      finanzas,
      comunicaciones,
      visitas,
      calendario,
      notice: { reservedLegalConfidential, redaction: redactionNotice },
    };

    const reservedNotice =
      reservedLegalConfidential > 0
        ? `<p><strong>Aviso:</strong> existen ${reservedLegalConfidential} registro(s) reservado(s) por confidencialidad legal que no se incluyen en este paquete (exención de acceso).</p>`
        : '';
    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Paquete ARCO — ${this.escapeHtml(resident.firstName)} ${this.escapeHtml(resident.lastName)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;line-height:1.5;color:#1f2937">
<h1>Paquete de Acceso (ARCO)</h1>
<p>Datos personales que el condominio conserva sobre el titular, generados el ${this.escapeHtml(data.generatedAt)}.</p>
<h2>Titular</h2>
<ul>
<li><strong>Nombre:</strong> ${this.escapeHtml(resident.firstName)} ${this.escapeHtml(resident.lastName)}</li>
<li><strong>Unidad:</strong> ${this.escapeHtml(resident.unitNumber)}</li>
<li><strong>Contacto:</strong> ${this.escapeHtml(resident.phone)} · ${this.escapeHtml(resident.email)}</li>
</ul>
<h2>Resumen</h2>
<ul>
<li>Vehículos: ${resident.vehicles.length}</li>
<li>Mascotas: ${resident.pets.length}</li>
<li>Residentes adicionales: ${resident.additionalResidents.length}</li>
<li>Antecedentes incluidos: ${entries.length}</li>
<li>Movimientos financieros: ${finanzas.transactions.length} · meses registrados: ${finanzas.collectionRecords.length}</li>
<li>Conversaciones (solo hechos): ${comunicaciones.length}</li>
<li>Visitas (solo fechas): ${visitas.length}</li>
<li>Eventos de calendario: ${calendario.length}</li>
</ul>
${reservedNotice}
<p><strong>Protección de datos de terceros:</strong> ${this.escapeHtml(redactionNotice)}</p>
<p>El detalle estructurado está en <code>datos.json</code>; la evidencia documental, en la carpeta <code>evidencia/</code>.</p>
</body></html>`;

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('warning', (err) => reject(err));
      archive.on('error', (err) => reject(err));
    });

    archive.append(html, { name: 'index.html' });
    archive.append(JSON.stringify(data, null, 2), { name: 'datos.json' });

    for (const entry of entries) {
      for (const att of entry.attachments) {
        const buffer = await this.storage.downloadFile(att.storageKey, {
          userId,
          condominiumId,
          byteSize: att.fileSizeBytes,
        });
        archive.append(buffer, {
          name: `evidencia/${entry.id}/${att.id}-${this.sanitizeFileName(att.fileName)}`,
        });
      }
    }

    await archive.finalize();
    await finished;

    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.DOSSIER_ARCO_EXPORTED,
      actionCategory: 'READ',
      module: DOSSIER_MODULE,
      entityType: 'Resident',
      entityId: residentId,
      afterState: {
        entries: entries.length,
        reservedLegalConfidential,
        transactions: finanzas.transactions.length,
        collectionRecords: finanzas.collectionRecords.length,
        conversations: comunicaciones.length,
        visits: visitas.length,
        calendarEvents: calendario.length,
      },
      result: 'SUCCESS',
    });

    return {
      buffer: Buffer.concat(chunks),
      fileName: `arco_${residentId}.zip`,
      entries: entries.length,
      reservedLegalConfidential,
    };
  }

  // Manual hard-delete (purge) of an already soft-deleted entry. Nothing is ever
  // purged automatically — this is an explicit human action, audited, and it
  // removes the R2 evidence too. The entry must be soft-deleted first, and the
  // caller must be able to view its confidentiality tier.
  async purge(
    condominiumId: string,
    residentId: string,
    entryId: string,
    userId: string,
  ) {
    const entry = await this.prisma.residentDossierEntry.findFirst({
      where: { id: entryId, condominiumId, residentId },
      include: { attachments: true },
    });
    if (!entry) throw new NotFoundException('Dossier entry not found');

    const levels = await this.allowedLevels(userId);
    if (!levels.includes(entry.confidentiality)) {
      throw new ForbiddenException('errors.dossier.forbiddenLevel');
    }
    if (!entry.deletedAt) {
      throw new UnprocessableEntityException('errors.dossier.mustSoftDeleteFirst');
    }

    // Best-effort R2 cleanup before the row is gone — a storage hiccup must not
    // block the purge; the object is orphaned, not leaked.
    for (const att of entry.attachments) {
      await this.storage
        .deleteFile(att.storageKey, { condominiumId })
        .catch(() => undefined);
    }

    // Hard delete — cascade removes attachments + events.
    await this.prisma.residentDossierEntry.delete({ where: { id: entry.id } });

    const { attachments, ...entryScalar } = entry;
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.DOSSIER_HARD_DELETED,
      actionCategory: 'DELETE',
      module: DOSSIER_MODULE,
      entityType: 'ResidentDossierEntry',
      entityId: entryId,
      beforeState: { ...entryScalar, attachmentCount: attachments.length },
      afterState: null,
      result: 'SUCCESS',
    });

    return { id: entryId, purged: true };
  }
}
