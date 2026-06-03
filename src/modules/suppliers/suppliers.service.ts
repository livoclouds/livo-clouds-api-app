import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersDto } from './dto/list-suppliers.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

const SUPPLIERS_MODULE = 'suppliers';

const AUDIT_ACTION = {
  SUPPLIER_CREATED: 'SUPPLIER_CREATED',
  SUPPLIER_UPDATED: 'SUPPLIER_UPDATED',
  SUPPLIER_DELETED: 'SUPPLIER_DELETED',
} as const;

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
      contactName: dto.contactName,
      email: dto.email,
      phone: dto.phone,
      address: dto.address,
      taxId: dto.taxId,
      registrationDate: dto.registrationDate
        ? new Date(dto.registrationDate)
        : undefined,
      status: dto.status,
      notes: dto.notes,
    };
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

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.supplier.count({ where }),
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

  async findOne(condominiumId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, condominiumId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async create(
    condominiumId: string,
    userId: string,
    dto: CreateSupplierDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        // `supplierName` and `type` are re-read from the create DTO after the
        // spread so their required types narrow correctly. `condominiumId`
        // comes from the guard-derived session value so a request body can
        // never override tenant scope. `createdBy`/`updatedBy` carry the JWT
        // `sub` — API-owned, never from the request body.
        data: {
          ...this.toSupplierData(dto),
          supplierName: dto.supplierName,
          type: dto.type,
          condominiumId,
          createdBy: userId,
          updatedBy: userId,
        },
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
}

// ─── Server-side query builders ────────────────────────────────────────────────

// Builds the Prisma `where` for the suppliers list. Tenant isolation
// (condominiumId) and soft-delete visibility (deletedAt: null) are always
// applied and are never derived from request input. Text filters use a
// case-insensitive substring match; enum filters are exact matches.
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
  if (dto.status) {
    and.push({ status: dto.status });
  }

  return {
    condominiumId,
    deletedAt: null,
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
