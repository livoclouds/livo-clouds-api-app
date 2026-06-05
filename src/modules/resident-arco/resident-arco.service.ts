import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ArcoRequestEventType, ArcoRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { ResidentDossierService } from '../resident-dossier/resident-dossier.service';
import { CreateArcoRequestDto } from './dto/create-arco-request.dto';
import { ListArcoRequestsDto } from './dto/list-arco-requests.dto';
import { UpdateArcoRequestDto } from './dto/update-arco-request.dto';
import { computeArcoDueDate } from './arco-due-date.util';

const ARCO_MODULE = 'resident-arco';

const AUDIT_ACTION = {
  ARCO_CREATED: 'ARCO_CREATED',
  ARCO_UPDATED: 'ARCO_UPDATED',
  ARCO_DELETED: 'ARCO_DELETED',
  ARCO_VIEWED: 'ARCO_VIEWED',
  ARCO_LIST_VIEWED: 'ARCO_LIST_VIEWED',
  ARCO_NOTE_ADDED: 'ARCO_NOTE_ADDED',
  ARCO_ATTACHMENT_ADDED: 'ARCO_ATTACHMENT_ADDED',
  ARCO_ATTACHMENT_REMOVED: 'ARCO_ATTACHMENT_REMOVED',
  ARCO_ACCESS_PACKET_GENERATED: 'ARCO_ACCESS_PACKET_GENERATED',
} as const;

// Evidence — PDF + images, 10 MB/file (under the API's 20 MB multipart cap).
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// `storageKey` is internal (R2 path) and must never leave the API.
const REQUEST_INCLUDE = {
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
} satisfies Prisma.ArcoRequestInclude;

const TERMINAL_STATUSES: ArcoRequestStatus[] = [
  ArcoRequestStatus.COMPLETED,
  ArcoRequestStatus.REJECTED,
];

export interface UploadedArcoFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class ResidentArcoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly dossier: ResidentDossierService,
  ) {}

  private validateFile(file: UploadedArcoFile) {
    if (!ALLOWED_MIME.includes(file.mimeType)) {
      throw new BadRequestException('errors.arco.invalidFileType');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('errors.arco.fileTooLarge');
    }
  }

  private sanitizeFileName(name: string): string {
    const cleaned = (name || 'file')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    return cleaned.slice(-120) || 'file';
  }

  private async storeAttachment(
    condominiumId: string,
    arcoRequestId: string,
    userId: string,
    file: UploadedArcoFile,
  ) {
    this.validateFile(file);
    const key = `condominiums/${condominiumId}/arco-requests/${arcoRequestId}/${randomUUID()}-${this.sanitizeFileName(
      file.originalName,
    )}`;
    await this.storage.uploadFile(key, file.buffer, file.mimeType, {
      userId,
      condominiumId,
      byteSize: file.size,
    });
    return this.prisma.arcoRequestAttachment.create({
      data: {
        condominiumId,
        arcoRequestId,
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

  private async assertResident(condominiumId: string, residentId: string) {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
      select: { id: true },
    });
    if (!resident) throw new NotFoundException('Resident not found');
  }

  private async loadRequestOrFail(
    condominiumId: string,
    residentId: string,
    requestId: string,
  ) {
    const request = await this.prisma.arcoRequest.findFirst({
      where: { id: requestId, condominiumId, residentId, deletedAt: null },
    });
    if (!request) throw new NotFoundException('ARCO request not found');
    return request;
  }

  async findAll(
    condominiumId: string,
    residentId: string,
    userId: string,
    query: ListArcoRequestsDto = {},
  ) {
    await this.assertResident(condominiumId, residentId);

    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.ARCO_LIST_VIEWED,
      actionCategory: 'READ',
      module: ARCO_MODULE,
      entityType: 'Resident',
      entityId: residentId,
      result: 'SUCCESS',
    });

    return this.prisma.arcoRequest.findMany({
      where: {
        condominiumId,
        residentId,
        deletedAt: null,
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: REQUEST_INCLUDE,
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // Condominium-wide compliance list — every ARCO request across all residents,
  // soonest legal deadline first. Tenant-scoped; reads a lean projection (no
  // events/attachments, never storageKey) plus the resident's identity for the
  // table. Audited as a condominium-scope list view.
  async findAllByCondominium(
    condominiumId: string,
    userId: string,
    query: ListArcoRequestsDto = {},
  ) {
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.ARCO_LIST_VIEWED,
      actionCategory: 'READ',
      module: ARCO_MODULE,
      entityType: 'Condominium',
      entityId: condominiumId,
      result: 'SUCCESS',
    });

    return this.prisma.arcoRequest.findMany({
      where: {
        condominiumId,
        deletedAt: null,
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      select: {
        id: true,
        residentId: true,
        type: true,
        status: true,
        channel: true,
        description: true,
        resolution: true,
        referenceFolio: true,
        receivedAt: true,
        dueDate: true,
        resolvedAt: true,
        createdBy: true,
        updatedBy: true,
        createdAt: true,
        updatedAt: true,
        resident: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            unitNumber: true,
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }],
    });
  }

  async findOne(
    condominiumId: string,
    residentId: string,
    requestId: string,
    userId: string,
  ) {
    const request = await this.prisma.arcoRequest.findFirst({
      where: { id: requestId, condominiumId, residentId, deletedAt: null },
      include: REQUEST_INCLUDE,
    });
    if (!request) throw new NotFoundException('ARCO request not found');

    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.ARCO_VIEWED,
      actionCategory: 'READ',
      module: ARCO_MODULE,
      entityType: 'ArcoRequest',
      entityId: request.id,
      result: 'SUCCESS',
    });

    return request;
  }

  async create(
    condominiumId: string,
    residentId: string,
    userId: string,
    dto: CreateArcoRequestDto,
    files: UploadedArcoFile[] = [],
  ) {
    await this.assertResident(condominiumId, residentId);
    files.forEach((f) => this.validateFile(f));

    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    const dueDate = computeArcoDueDate(receivedAt);

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.arcoRequest.create({
        data: {
          condominiumId,
          residentId,
          type: dto.type,
          status: dto.status ?? ArcoRequestStatus.RECEIVED,
          channel: dto.channel,
          description: dto.description,
          referenceFolio: dto.referenceFolio,
          receivedAt,
          dueDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await tx.arcoRequestEvent.create({
        data: {
          condominiumId,
          arcoRequestId: request.id,
          type: ArcoRequestEventType.CREATED,
          toStatus: request.status,
          createdBy: userId,
        },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.ARCO_CREATED,
          actionCategory: 'CREATE',
          module: ARCO_MODULE,
          entityType: 'ArcoRequest',
          entityId: request.id,
          afterState: request,
          result: 'SUCCESS',
        },
        tx,
      );

      return request;
    });

    for (const file of files) {
      await this.storeAttachment(condominiumId, created.id, userId, file);
    }

    return this.prisma.arcoRequest.findFirst({
      where: { id: created.id },
      include: REQUEST_INCLUDE,
    });
  }

  async update(
    condominiumId: string,
    residentId: string,
    requestId: string,
    userId: string,
    dto: UpdateArcoRequestDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.arcoRequest.findFirst({
        where: { id: requestId, condominiumId, residentId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('ARCO request not found');

      const nextStatus = (dto.status ?? before.status) as ArcoRequestStatus;
      const statusChanged = nextStatus !== before.status;
      // Stamp resolvedAt when entering a terminal state (unless explicitly given).
      const resolvedAt =
        dto.resolvedAt !== undefined
          ? dto.resolvedAt
            ? new Date(dto.resolvedAt)
            : null
          : statusChanged && TERMINAL_STATUSES.includes(nextStatus)
            ? new Date()
            : undefined;

      const result = await tx.arcoRequest.updateMany({
        where: { id: requestId, condominiumId, residentId, deletedAt: null },
        data: {
          type: dto.type,
          status: dto.status,
          channel: dto.channel,
          resolution: dto.resolution,
          referenceFolio: dto.referenceFolio,
          resolvedAt,
          updatedBy: userId,
        },
      });
      if (result.count === 0) throw new NotFoundException('ARCO request not found');

      await tx.arcoRequestEvent.create({
        data: {
          condominiumId,
          arcoRequestId: requestId,
          type: statusChanged
            ? ArcoRequestEventType.STATUS_CHANGED
            : ArcoRequestEventType.UPDATED,
          fromStatus: statusChanged ? before.status : null,
          toStatus: statusChanged ? nextStatus : null,
          createdBy: userId,
        },
      });

      const updated = await tx.arcoRequest.findFirst({
        where: { id: requestId },
        include: REQUEST_INCLUDE,
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.ARCO_UPDATED,
          actionCategory: 'UPDATE',
          module: ARCO_MODULE,
          entityType: 'ArcoRequest',
          entityId: requestId,
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
    requestId: string,
    userId: string,
    note: string,
  ) {
    await this.loadRequestOrFail(condominiumId, residentId, requestId);
    await this.prisma.arcoRequestEvent.create({
      data: {
        condominiumId,
        arcoRequestId: requestId,
        type: ArcoRequestEventType.NOTE_ADDED,
        note: note.slice(0, 2000),
        createdBy: userId,
      },
    });
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.ARCO_NOTE_ADDED,
      actionCategory: 'UPDATE',
      module: ARCO_MODULE,
      entityType: 'ArcoRequest',
      entityId: requestId,
      result: 'SUCCESS',
    });
    return this.prisma.arcoRequest.findFirst({
      where: { id: requestId },
      include: REQUEST_INCLUDE,
    });
  }

  async addAttachments(
    condominiumId: string,
    residentId: string,
    requestId: string,
    userId: string,
    files: UploadedArcoFile[],
  ) {
    await this.loadRequestOrFail(condominiumId, residentId, requestId);
    if (files.length === 0) {
      throw new BadRequestException('errors.arco.noFile');
    }
    for (const file of files) {
      await this.storeAttachment(condominiumId, requestId, userId, file);
      await this.prisma.arcoRequestEvent.create({
        data: {
          condominiumId,
          arcoRequestId: requestId,
          type: ArcoRequestEventType.ATTACHMENT_ADDED,
          note: file.originalName.slice(0, 2000),
          createdBy: userId,
        },
      });
    }
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.ARCO_ATTACHMENT_ADDED,
      actionCategory: 'UPDATE',
      module: ARCO_MODULE,
      entityType: 'ArcoRequest',
      entityId: requestId,
      result: 'SUCCESS',
    });
    return this.prisma.arcoRequest.findFirst({
      where: { id: requestId },
      include: REQUEST_INCLUDE,
    });
  }

  async getAttachmentUrl(
    condominiumId: string,
    residentId: string,
    requestId: string,
    attachmentId: string,
    userId: string,
  ): Promise<{ url: string }> {
    await this.loadRequestOrFail(condominiumId, residentId, requestId);
    const attachment = await this.prisma.arcoRequestAttachment.findFirst({
      where: { id: attachmentId, arcoRequestId: requestId, condominiumId },
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
    requestId: string,
    attachmentId: string,
    userId: string,
  ) {
    await this.loadRequestOrFail(condominiumId, residentId, requestId);
    const attachment = await this.prisma.arcoRequestAttachment.findFirst({
      where: { id: attachmentId, arcoRequestId: requestId, condominiumId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    await this.prisma.arcoRequestAttachment.delete({ where: { id: attachment.id } });
    await this.storage
      .deleteFile(attachment.storageKey, { condominiumId })
      .catch(() => undefined);

    await this.prisma.arcoRequestEvent.create({
      data: {
        condominiumId,
        arcoRequestId: requestId,
        type: ArcoRequestEventType.ATTACHMENT_REMOVED,
        note: attachment.fileName,
        createdBy: userId,
      },
    });
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.ARCO_ATTACHMENT_REMOVED,
      actionCategory: 'DELETE',
      module: ARCO_MODULE,
      entityType: 'ArcoRequest',
      entityId: requestId,
      result: 'SUCCESS',
    });
    return { id: attachmentId, deleted: true };
  }

  async remove(
    condominiumId: string,
    residentId: string,
    requestId: string,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.arcoRequest.findFirst({
        where: { id: requestId, condominiumId, residentId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('ARCO request not found');

      const result = await tx.arcoRequest.updateMany({
        where: { id: requestId, condominiumId, residentId, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: userId },
      });
      if (result.count === 0) throw new NotFoundException('ARCO request not found');

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.ARCO_DELETED,
          actionCategory: 'DELETE',
          module: ARCO_MODULE,
          entityType: 'ArcoRequest',
          entityId: requestId,
          beforeState: before,
          afterState: null,
          result: 'SUCCESS',
        },
        tx,
      );

      return { id: requestId, deleted: true };
    });
  }

  // For an ACCESS-type request, generate the existing dossier ARCO packet (2D/2E),
  // record the generation on the request timeline, and audit it as part of the
  // ARCO flow. Returns the ZIP for the controller to stream.
  async generateAccessPacket(
    condominiumId: string,
    residentId: string,
    requestId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const request = await this.loadRequestOrFail(condominiumId, residentId, requestId);
    if (request.type !== 'ACCESS') {
      throw new BadRequestException('errors.arco.notAccessType');
    }

    const packet = await this.dossier.exportArcoPacket(condominiumId, residentId, userId);

    await this.prisma.arcoRequestEvent.create({
      data: {
        condominiumId,
        arcoRequestId: requestId,
        type: ArcoRequestEventType.ACCESS_PACKET_GENERATED,
        note: packet.fileName,
        createdBy: userId,
      },
    });
    await this.audit.log({
      condominiumId,
      userId,
      action: AUDIT_ACTION.ARCO_ACCESS_PACKET_GENERATED,
      actionCategory: 'READ',
      module: ARCO_MODULE,
      entityType: 'ArcoRequest',
      entityId: requestId,
      afterState: { fileName: packet.fileName, entries: packet.entries },
      result: 'SUCCESS',
    });

    return { buffer: packet.buffer, fileName: packet.fileName };
  }
}
