import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Quotation, QuotationRequest } from '@prisma/client';

import { PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateQuotationRequestDto } from './dto/create-quotation-request.dto';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { ListQuotationsDto } from './dto/list-quotations.dto';
import { UpdateQuotationRequestDto } from './dto/update-quotation-request.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';

const QUOTATIONS_MODULE = 'quotations';
const AUDIT_ACTION = {
  REQUEST_CREATED: 'QUOTATION_REQUEST_CREATED',
  REQUEST_UPDATED: 'QUOTATION_REQUEST_UPDATED',
  REQUEST_DELETED: 'QUOTATION_REQUEST_DELETED',
  QUOTATION_ADDED: 'QUOTATION_ADDED',
  QUOTATION_UPDATED: 'QUOTATION_UPDATED',
  QUOTATION_REMOVED: 'QUOTATION_REMOVED',
} as const;

// Response shapes mirror the web app's quotations.types.ts exactly: Decimal
// amounts are returned as numbers and dates as ISO strings, so the proxy needs
// no transform layer.
interface QuotationView {
  id: string;
  requestId: string;
  providerName: string;
  providerPhone: string | null;
  providerEmail: string | null;
  amount: number;
  currency: string;
  quoteDate: string;
  estimatedStartDate: string | null;
  estimatedEndDate: string | null;
  documentUrl: string | null;
  notes: string;
}

interface QuotationRequestView {
  id: string;
  title: string;
  description: string;
  category: QuotationRequest['category'];
  status: QuotationRequest['status'];
  createdAt: string;
  targetStartDate: string | null;
  targetEndDate: string | null;
  selectedQuotationId: string | null;
  beforePhotos: string[];
  afterPhotos: string[];
  comments: string;
  quotations: QuotationView[];
}

interface QuotationRequestListItem
  extends Omit<QuotationRequestView, 'quotations'> {
  quotationsCount: number;
  selectedQuotation: QuotationView | null;
  lowestAmount: number | null;
}

type RequestWithQuotations = QuotationRequest & { quotations: Quotation[] };

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  async findAll(
    condominiumId: string,
    query: ListQuotationsDto = {},
  ): Promise<PaginatedResult<QuotationRequestListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.QuotationRequestWhereInput = {
      condominiumId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.quotationRequest.findMany({
        where,
        include: { quotations: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.quotationRequest.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toListItem(r)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(
    condominiumId: string,
    id: string,
  ): Promise<QuotationRequestView> {
    const request = await this.requireRequest(condominiumId, id);
    return this.toView(request);
  }

  // ── Request mutations ────────────────────────────────────────────────────────

  async create(
    condominiumId: string,
    userId: string,
    dto: CreateQuotationRequestDto,
  ): Promise<QuotationRequestView> {
    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.quotationRequest.create({
        data: {
          condominiumId,
          title: dto.title,
          description: dto.description ?? '',
          category: dto.category,
          targetStartDate: dto.targetStartDate
            ? new Date(dto.targetStartDate)
            : null,
          targetEndDate: dto.targetEndDate ? new Date(dto.targetEndDate) : null,
          comments: dto.comments ?? '',
          createdBy: userId,
          updatedBy: userId,
        },
        include: { quotations: true },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.REQUEST_CREATED,
          actionCategory: 'CREATE',
          module: QUOTATIONS_MODULE,
          entityType: 'QuotationRequest',
          entityId: request.id,
          afterState: { title: request.title, category: request.category },
          result: 'SUCCESS',
        },
        tx,
      );

      return request;
    });

    return this.toView(created);
  }

  async update(
    condominiumId: string,
    userId: string,
    id: string,
    dto: UpdateQuotationRequestDto,
  ): Promise<QuotationRequestView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.quotationRequest.findFirst({
        where: { id, condominiumId, deletedAt: null },
        include: { quotations: { select: { id: true } } },
      });
      if (!before) {
        throw new NotFoundException('quotations.errors.requestNotFound');
      }

      // A non-null selection must reference one of this request's own quotations.
      if (
        dto.selectedQuotationId != null &&
        !before.quotations.some((q) => q.id === dto.selectedQuotationId)
      ) {
        throw new BadRequestException(
          'quotations.errors.invalidSelectedQuotation',
        );
      }

      const data: Prisma.QuotationRequestUpdateInput = { updatedBy: userId };
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.category !== undefined) data.category = dto.category;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.comments !== undefined) data.comments = dto.comments;
      if (dto.targetStartDate !== undefined)
        data.targetStartDate = dto.targetStartDate
          ? new Date(dto.targetStartDate)
          : null;
      if (dto.targetEndDate !== undefined)
        data.targetEndDate = dto.targetEndDate
          ? new Date(dto.targetEndDate)
          : null;
      if (dto.selectedQuotationId !== undefined)
        data.selectedQuotationId = dto.selectedQuotationId;
      if (dto.beforePhotos !== undefined) data.beforePhotos = dto.beforePhotos;
      if (dto.afterPhotos !== undefined) data.afterPhotos = dto.afterPhotos;

      const request = await tx.quotationRequest.update({
        where: { id },
        data,
        include: { quotations: true },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.REQUEST_UPDATED,
          actionCategory: 'UPDATE',
          module: QUOTATIONS_MODULE,
          entityType: 'QuotationRequest',
          entityId: request.id,
          beforeState: { status: before.status },
          afterState: { status: request.status },
          result: 'SUCCESS',
        },
        tx,
      );

      return request;
    });

    return this.toView(updated);
  }

  async remove(
    condominiumId: string,
    userId: string,
    id: string,
  ): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.quotationRequest.findFirst({
        where: { id, condominiumId, deletedAt: null },
      });
      if (!before) {
        throw new NotFoundException('quotations.errors.requestNotFound');
      }

      await tx.quotationRequest.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.REQUEST_DELETED,
          actionCategory: 'DELETE',
          module: QUOTATIONS_MODULE,
          entityType: 'QuotationRequest',
          entityId: id,
          beforeState: { title: before.title, status: before.status },
          afterState: null,
          result: 'SUCCESS',
        },
        tx,
      );
    });

    return { ok: true };
  }

  // ── Nested quotation mutations ───────────────────────────────────────────────

  async addQuotation(
    condominiumId: string,
    userId: string,
    requestId: string,
    dto: CreateQuotationDto,
  ): Promise<QuotationView> {
    // Guard the parent first: a quote can only attach to a live, in-tenant request.
    await this.requireRequest(condominiumId, requestId);

    const created = await this.prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.create({
        data: {
          condominiumId,
          requestId,
          providerName: dto.providerName,
          providerPhone: dto.providerPhone ?? null,
          providerEmail: dto.providerEmail ?? null,
          amount: new Prisma.Decimal(dto.amount),
          currency: dto.currency ?? 'MXN',
          quoteDate: new Date(dto.quoteDate),
          estimatedStartDate: dto.estimatedStartDate
            ? new Date(dto.estimatedStartDate)
            : null,
          estimatedEndDate: dto.estimatedEndDate
            ? new Date(dto.estimatedEndDate)
            : null,
          documentUrl: dto.documentUrl ?? null,
          notes: dto.notes ?? '',
        },
      });

      await tx.quotationRequest.update({
        where: { id: requestId },
        data: { updatedBy: userId },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.QUOTATION_ADDED,
          actionCategory: 'CREATE',
          module: QUOTATIONS_MODULE,
          entityType: 'Quotation',
          entityId: quotation.id,
          afterState: {
            requestId,
            providerName: quotation.providerName,
            amount: quotation.amount.toString(),
          },
          result: 'SUCCESS',
        },
        tx,
      );

      return quotation;
    });

    return this.toQuotationView(created);
  }

  async updateQuotation(
    condominiumId: string,
    userId: string,
    requestId: string,
    quotationId: string,
    dto: UpdateQuotationDto,
  ): Promise<QuotationView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.quotation.findFirst({
        where: { id: quotationId, requestId, condominiumId },
      });
      if (!before) {
        throw new NotFoundException('quotations.errors.quotationNotFound');
      }

      const data: Prisma.QuotationUpdateInput = {};
      if (dto.providerName !== undefined) data.providerName = dto.providerName;
      if (dto.providerPhone !== undefined)
        data.providerPhone = dto.providerPhone ?? null;
      if (dto.providerEmail !== undefined)
        data.providerEmail = dto.providerEmail ?? null;
      if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
      if (dto.currency !== undefined) data.currency = dto.currency;
      if (dto.quoteDate !== undefined) data.quoteDate = new Date(dto.quoteDate);
      if (dto.estimatedStartDate !== undefined)
        data.estimatedStartDate = dto.estimatedStartDate
          ? new Date(dto.estimatedStartDate)
          : null;
      if (dto.estimatedEndDate !== undefined)
        data.estimatedEndDate = dto.estimatedEndDate
          ? new Date(dto.estimatedEndDate)
          : null;
      if (dto.documentUrl !== undefined)
        data.documentUrl = dto.documentUrl ?? null;
      if (dto.notes !== undefined) data.notes = dto.notes;

      const quotation = await tx.quotation.update({
        where: { id: quotationId },
        data,
      });

      await tx.quotationRequest.update({
        where: { id: requestId },
        data: { updatedBy: userId },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.QUOTATION_UPDATED,
          actionCategory: 'UPDATE',
          module: QUOTATIONS_MODULE,
          entityType: 'Quotation',
          entityId: quotationId,
          result: 'SUCCESS',
        },
        tx,
      );

      return quotation;
    });

    return this.toQuotationView(updated);
  }

  async removeQuotation(
    condominiumId: string,
    userId: string,
    requestId: string,
    quotationId: string,
  ): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.quotation.findFirst({
        where: { id: quotationId, requestId, condominiumId },
      });
      if (!before) {
        throw new NotFoundException('quotations.errors.quotationNotFound');
      }

      await tx.quotation.delete({ where: { id: quotationId } });

      // If the removed quote was the selected winner, clear the selection so the
      // request never points at a non-existent quotation.
      const parent = await tx.quotationRequest.findUnique({
        where: { id: requestId },
        select: { selectedQuotationId: true },
      });
      await tx.quotationRequest.update({
        where: { id: requestId },
        data: {
          updatedBy: userId,
          ...(parent?.selectedQuotationId === quotationId
            ? { selectedQuotationId: null }
            : {}),
        },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.QUOTATION_REMOVED,
          actionCategory: 'DELETE',
          module: QUOTATIONS_MODULE,
          entityType: 'Quotation',
          entityId: quotationId,
          beforeState: { requestId, providerName: before.providerName },
          afterState: null,
          result: 'SUCCESS',
        },
        tx,
      );
    });

    return { ok: true };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async requireRequest(
    condominiumId: string,
    id: string,
  ): Promise<RequestWithQuotations> {
    const request = await this.prisma.quotationRequest.findFirst({
      where: { id, condominiumId, deletedAt: null },
      include: { quotations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!request) {
      throw new NotFoundException('quotations.errors.requestNotFound');
    }
    return request;
  }

  private toQuotationView(q: Quotation): QuotationView {
    return {
      id: q.id,
      requestId: q.requestId,
      providerName: q.providerName,
      providerPhone: q.providerPhone,
      providerEmail: q.providerEmail,
      amount: Number(q.amount),
      currency: q.currency,
      quoteDate: q.quoteDate.toISOString(),
      estimatedStartDate: iso(q.estimatedStartDate),
      estimatedEndDate: iso(q.estimatedEndDate),
      documentUrl: q.documentUrl,
      notes: q.notes,
    };
  }

  private toView(r: RequestWithQuotations): QuotationRequestView {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      targetStartDate: iso(r.targetStartDate),
      targetEndDate: iso(r.targetEndDate),
      selectedQuotationId: r.selectedQuotationId,
      beforePhotos: r.beforePhotos,
      afterPhotos: r.afterPhotos,
      comments: r.comments,
      quotations: r.quotations.map((q) => this.toQuotationView(q)),
    };
  }

  private toListItem(r: RequestWithQuotations): QuotationRequestListItem {
    const quotations = r.quotations.map((q) => this.toQuotationView(q));
    const selected =
      quotations.find((q) => q.id === r.selectedQuotationId) ?? null;
    const lowestAmount = quotations.length
      ? Math.min(...quotations.map((q) => q.amount))
      : null;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      targetStartDate: iso(r.targetStartDate),
      targetEndDate: iso(r.targetEndDate),
      selectedQuotationId: r.selectedQuotationId,
      beforePhotos: r.beforePhotos,
      afterPhotos: r.afterPhotos,
      comments: r.comments,
      quotationsCount: quotations.length,
      selectedQuotation: selected,
      lowestAmount,
    };
  }
}
