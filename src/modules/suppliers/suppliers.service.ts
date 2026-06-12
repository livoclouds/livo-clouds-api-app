import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersDto } from './dto/list-suppliers.dto';
import { RateSupplierDto } from './dto/rate-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

const SUPPLIERS_MODULE = 'suppliers';

const AUDIT_ACTION = {
  SUPPLIER_CREATED: 'SUPPLIER_CREATED',
  SUPPLIER_UPDATED: 'SUPPLIER_UPDATED',
  SUPPLIER_DELETED: 'SUPPLIER_DELETED',
  SUPPLIER_RESTORED: 'SUPPLIER_RESTORED',
  SUPPLIER_RATED: 'SUPPLIER_RATED',
  SUPPLIER_DELETED_PERMANENT: 'SUPPLIER_DELETED_PERMANENT',
} as const;

// Derived, read-only aggregates attached to each supplier for the directory UI.
// `averageRating`/`ratingCount` come from the SupplierRating history; `jobsCount`
// and `historicalSpend` are Phase-2 placeholders (jobs are not modeled yet).
export interface SupplierAggregates {
  averageRating: number;
  ratingCount: number;
  jobsCount: number;
  historicalSpend: number;
}

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // Builds an explicit, allow-listed Prisma payload from a supplier DTO. The
  // DTO (or request body) must never be spread into Prisma `data:` — the
  // allow-list is the structural guarantee that `condominiumId`, `deletedAt`,
  // `createdBy`, `updatedBy`, or any other unknown key can never be written
  // through a request body (mass-assignment guard). Prisma treats `undefined`
  // as "leave unchanged", so the same mapper is safe for create and partial
  // update.
  private toSupplierData(dto: CreateSupplierDto | UpdateSupplierDto) {
    return {
      supplierName: dto.supplierName,
      type: dto.type,
      categoryId: dto.categoryId ?? null,
      engagementType: dto.engagementType,
      contactName: dto.contactName,
      email: dto.email,
      phone: dto.phone,
      whatsapp: dto.whatsapp,
      address: dto.address,
      availability: dto.availability,
      servesResidents: dto.servesResidents,
      references: dto.references,
      taxId: dto.taxId,
      registrationDate: dto.registrationDate
        ? new Date(dto.registrationDate)
        : undefined,
      status: dto.status,
      notes: dto.notes,
    };
  }

  // Attaches read-only rating aggregates to each supplier row in one grouped
  // query (no N+1). `averageRating` is rounded to one decimal to match the UI.
  private async attachAggregates<T extends { id: string }>(
    rows: T[],
  ): Promise<(T & SupplierAggregates)[]> {
    if (rows.length === 0) return [];
    const grouped = await this.prisma.supplierRating.groupBy({
      by: ['supplierId'],
      where: { supplierId: { in: rows.map((r) => r.id) } },
      _avg: { score: true },
      _count: { _all: true },
    });
    const byId = new Map(grouped.map((g) => [g.supplierId, g]));
    return rows.map((r) => {
      const g = byId.get(r.id);
      const avg = g?._avg.score ?? 0;
      return {
        ...r,
        averageRating: avg ? Math.round(avg * 10) / 10 : 0,
        ratingCount: g?._count._all ?? 0,
        jobsCount: 0,
        historicalSpend: 0,
      };
    });
  }

  async findAll(
    condominiumId: string,
    query: ListSuppliersDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 200;
    const skip = (page - 1) * limit;
    // `where` always includes the structural tenant scope + soft-delete filter;
    // `orderBy` only ever uses the allow-listed column mapping. `count` reuses
    // the same `where` so `meta` reflects the filtered total.
    const where = buildSupplierWhere(condominiumId, query);
    const orderBy = buildSupplierOrderBy(query);

    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy, skip, take: limit, include: { category: true } }),
      this.prisma.supplier.count({ where }),
    ]);
    const data = await this.attachAggregates(rows);

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

  async findOne(condominiumId: string, id: string) {
    // A detail view may target an archived supplier (opened from the Archivados
    // tab), so this read intentionally does NOT filter `deletedAt`.
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, condominiumId },
      include: { category: true },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const [withAggregates] = await this.attachAggregates([supplier]);
    return withAggregates;
  }

  async create(
    condominiumId: string,
    userId: string,
    dto: CreateSupplierDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          ...this.toSupplierData(dto),
          supplierName: dto.supplierName,
          condominiumId,
          createdBy: userId,
          updatedBy: userId,
        },
        include: { category: true },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.SUPPLIER_CREATED,
          actionCategory: 'CREATE',
          module: SUPPLIERS_MODULE,
          entityType: 'Supplier',
          entityId: created.id,
          afterState: created,
          result: 'SUCCESS',
        },
        tx,
      );

      return created;
    });
  }

  async update(
    condominiumId: string,
    userId: string,
    id: string,
    dto: UpdateSupplierDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supplier.findFirst({
        where: { id, condominiumId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Supplier not found');

      // updateMany keeps the `{ id, condominiumId, deletedAt: null }` filter
      // structural so tenant scope and soft-delete visibility do not rely on
      // the read above alone. `updatedBy` is appended outside the allow-listed
      // mapper so a request body can never override it.
      const result = await tx.supplier.updateMany({
        where: { id, condominiumId, deletedAt: null },
        data: { ...this.toSupplierData(dto), updatedBy: userId },
      });
      if (result.count === 0) throw new NotFoundException('Supplier not found');

      const updated = await tx.supplier.findFirst({
        where: { id, condominiumId, deletedAt: null },
        include: { category: true },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.SUPPLIER_UPDATED,
          actionCategory: 'UPDATE',
          module: SUPPLIERS_MODULE,
          entityType: 'Supplier',
          entityId: id,
          beforeState: before,
          afterState: updated,
          result: 'SUCCESS',
        },
        tx,
      );

      return updated;
    });
  }

  async remove(condominiumId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supplier.findFirst({
        where: { id, condominiumId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Supplier not found');

      // Soft delete. The `{ id, condominiumId, deletedAt: null }` filter makes
      // tenant isolation structural — it no longer depends on the read above.
      // The row remains for forensic recovery; reads filter `deletedAt` out.
      const result = await tx.supplier.updateMany({
        where: { id, condominiumId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) throw new NotFoundException('Supplier not found');

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.SUPPLIER_DELETED,
          actionCategory: 'DELETE',
          module: SUPPLIERS_MODULE,
          entityType: 'Supplier',
          entityId: id,
          beforeState: before,
          afterState: null,
          result: 'SUCCESS',
        },
        tx,
      );

      return before;
    });
  }

  // Restores an archived (soft-deleted) supplier back to the active directory.
  async restore(condominiumId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supplier.findFirst({
        where: { id, condominiumId, deletedAt: { not: null } },
      });
      if (!before) throw new NotFoundException('Supplier not found');

      const result = await tx.supplier.updateMany({
        where: { id, condominiumId, deletedAt: { not: null } },
        data: { deletedAt: null, updatedBy: userId },
      });
      if (result.count === 0) throw new NotFoundException('Supplier not found');

      const restored = await tx.supplier.findFirst({
        where: { id, condominiumId },
        include: { category: true },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.SUPPLIER_RESTORED,
          actionCategory: 'UPDATE',
          module: SUPPLIERS_MODULE,
          entityType: 'Supplier',
          entityId: id,
          beforeState: before,
          afterState: restored,
          result: 'SUCCESS',
        },
        tx,
      );

      return restored;
    });
  }

  // Appends a dated rating to a supplier's history and returns the refreshed
  // aggregates so the UI can update the average + count without a re-fetch.
  async addRating(
    condominiumId: string,
    userId: string,
    supplierId: string,
    dto: RateSupplierDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, condominiumId },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');

      const rating = await tx.supplierRating.create({
        data: {
          condominiumId,
          supplierId,
          score: dto.score,
          comment: dto.comment,
          createdBy: userId,
        },
      });

      const agg = await tx.supplierRating.aggregate({
        where: { supplierId },
        _avg: { score: true },
        _count: { _all: true },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.SUPPLIER_RATED,
          actionCategory: 'CREATE',
          module: SUPPLIERS_MODULE,
          entityType: 'SupplierRating',
          entityId: rating.id,
          afterState: rating,
          result: 'SUCCESS',
        },
        tx,
      );

      const avg = agg._avg.score ?? 0;
      return {
        rating,
        averageRating: avg ? Math.round(avg * 10) / 10 : 0,
        ratingCount: agg._count._all,
      };
    });
  }

  // Rating history for a supplier (most recent first).
  async listRatings(condominiumId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, condominiumId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    return this.prisma.supplierRating.findMany({
      where: { condominiumId, supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Permanently deletes a supplier registered by mistake. Refuses when the
  // supplier is referenced by any transaction (history must be preserved — the
  // caller should archive instead). When safe, it unlinks any reconciliation
  // rules (supplierId → null), removes the rating history, then hard-deletes the
  // row. Use `remove()` (archive) for the normal lifecycle.
  async hardDelete(condominiumId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supplier.findFirst({
        where: { id, condominiumId },
      });
      if (!before) throw new NotFoundException('Supplier not found');

      const txCount = await tx.transaction.count({
        where: { condominiumId, supplierId: id },
      });
      if (txCount > 0) {
        // i18n KEY surfaced to the web layer (mapped to a localized toast).
        throw new ConflictException('errors.supplierHasTransactions');
      }

      // Detach reconciliation rules so the FK does not block the delete; the
      // rules keep firing on keywords, just without a supplier outcome.
      await tx.reconciliationRule.updateMany({
        where: { condominiumId, supplierId: id },
        data: { supplierId: null },
      });
      await tx.supplierRating.deleteMany({ where: { condominiumId, supplierId: id } });
      await tx.supplier.delete({ where: { id } });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.SUPPLIER_DELETED_PERMANENT,
          actionCategory: 'DELETE',
          module: SUPPLIERS_MODULE,
          entityType: 'Supplier',
          entityId: id,
          beforeState: before,
          afterState: null,
          result: 'SUCCESS',
        },
        tx,
      );

      return before;
    });
  }
}

// ─── Server-side query builders ────────────────────────────────────────────────

// Builds the Prisma `where` for the suppliers list. Tenant isolation
// (condominiumId) is always applied and never derived from request input. The
// `archived` flag flips soft-delete visibility (active rows vs. the Archivados
// tab); text filters use a case-insensitive substring match; enum filters are
// exact matches.
function buildSupplierWhere(
  condominiumId: string,
  dto: ListSuppliersDto,
): Prisma.SupplierWhereInput {
  const and: Prisma.SupplierWhereInput[] = [];

  if (dto.search) {
    and.push({ supplierName: { contains: dto.search, mode: 'insensitive' } });
  }
  if (dto.type) {
    and.push({ type: dto.type });
  }
  if (dto.categoryId) {
    and.push({ categoryId: dto.categoryId });
  }
  if (dto.engagementType) {
    and.push({ engagementType: dto.engagementType });
  }
  if (dto.status) {
    and.push({ status: dto.status });
  }

  return {
    condominiumId,
    deletedAt: dto.archived ? { not: null } : null,
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

// Maps the validated `sortBy` to a deterministic Prisma `orderBy`. A
// client-supplied value never reaches Prisma directly: the DTO allow-list
// (@IsIn) plus this switch are the two safety layers. `id` is appended as a
// stable tiebreaker so pagination never skips or repeats a row.
function buildSupplierOrderBy(
  dto: ListSuppliersDto,
): Prisma.SupplierOrderByWithRelationInput[] {
  const dir: Prisma.SortOrder = dto.sortDirection === 'desc' ? 'desc' : 'asc';
  const tiebreaker: Prisma.SupplierOrderByWithRelationInput = { id: 'asc' };

  switch (dto.sortBy) {
    case 'type':
      return [{ type: dir }, tiebreaker];
    case 'status':
      return [{ status: dir }, tiebreaker];
    case 'registrationDate':
      return [{ registrationDate: dir }, tiebreaker];
    case 'createdAt':
      return [{ createdAt: dir }, tiebreaker];
    case 'updatedAt':
      return [{ updatedAt: dir }, tiebreaker];
    case 'supplierName':
    default:
      return [{ supplierName: dir }, tiebreaker];
  }
}
