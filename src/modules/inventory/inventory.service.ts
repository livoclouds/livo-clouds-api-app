import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { ListCommonAreasDto } from './dto/list-common-areas.dto';
import { ListInventoryItemsDto } from './dto/list-inventory-items.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';

const INVENTORY_MODULE = 'inventory';

const AUDIT_ACTION = {
  COMMON_AREA_CREATED: 'COMMON_AREA_CREATED',
  COMMON_AREA_UPDATED: 'COMMON_AREA_UPDATED',
  COMMON_AREA_DELETED: 'COMMON_AREA_DELETED',
  INVENTORY_ITEM_CREATED: 'INVENTORY_ITEM_CREATED',
  INVENTORY_ITEM_UPDATED: 'INVENTORY_ITEM_UPDATED',
  INVENTORY_ITEM_DELETED: 'INVENTORY_ITEM_DELETED',
} as const;

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ─── Common Areas ──────────────────────────────────────────────

  async findAllAreas(
    condominiumId: string,
    query: ListCommonAreasDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 200;
    const skip = (page - 1) * limit;
    // CMA-013: filtering and sorting run in the database. `where` is always
    // scoped by the guard-derived condominiumId; `orderBy` only ever uses the
    // allow-listed column mapping. `count` reuses the same `where` so `meta`
    // reflects the filtered total.
    const where = buildCommonAreaWhere(condominiumId, query);
    const orderBy = buildCommonAreaOrderBy(query);

    const [data, total] = await Promise.all([
      this.prisma.commonArea.findMany({
        where,
        include: { inventoryItems: true },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.commonArea.count({ where }),
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

  // Builds an explicit, allow-listed Prisma payload from a common-area DTO.
  // The DTO (or request body) must never be spread into Prisma `data:` — an
  // allow-list is the structural guarantee that `condominiumId`, or any other
  // unknown key, can never be written (CMA-003 mass-assignment guard). Prisma
  // treats `undefined` as "leave unchanged", so the same mapper is safe for
  // both create and partial update.
  private toCommonAreaData(dto: CreateCommonAreaDto | UpdateCommonAreaDto) {
    // CMA-010 (Phase 5): `nameKey` is no longer part of the write contract —
    // the free-text `name` is the single source of truth for area naming.
    return {
      name: dto.name,
      description: dto.description,
      physicalLocation: dto.physicalLocation,
      status: dto.status,
      responsiblePerson: dto.responsiblePerson,
    };
  }

  async createArea(
    condominiumId: string,
    userId: string,
    dto: CreateCommonAreaDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.commonArea.create({
        // `name` is re-read from the create DTO so its type stays required.
        // `createdBy` / `updatedBy` are API-owned audit fields — set from the
        // session user, never the request body, and appended outside the
        // allow-listed mapper. On create both record the creator, mirroring how
        // Prisma's `@updatedAt` makes `updatedAt` equal `createdAt` at creation.
        data: {
          ...this.toCommonAreaData(dto),
          name: dto.name,
          condominiumId,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.COMMON_AREA_CREATED,
          actionCategory: 'CREATE',
          module: INVENTORY_MODULE,
          entityType: 'CommonArea',
          entityId: created.id,
          afterState: created,
          result: 'SUCCESS',
        },
        tx,
      );

      return created;
    });
  }

  async updateArea(
    condominiumId: string,
    userId: string,
    id: string,
    dto: UpdateCommonAreaDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.commonArea.findFirst({
        where: { id, condominiumId },
        include: { inventoryItems: true },
      });
      if (!before) throw new NotFoundException('Common area not found');

      // updateMany keeps the `{ id, condominiumId }` filter structural, so
      // tenant scope does not rely on the read above alone. `updatedBy` is an
      // API-owned audit field — set from the session user and appended outside
      // the allow-listed mapper so a request body can never override it.
      await tx.commonArea.updateMany({
        where: { id, condominiumId },
        data: { ...this.toCommonAreaData(dto), updatedBy: userId },
      });

      const updated = await tx.commonArea.findFirst({
        where: { id, condominiumId },
        include: { inventoryItems: true },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.COMMON_AREA_UPDATED,
          actionCategory: 'UPDATE',
          module: INVENTORY_MODULE,
          entityType: 'CommonArea',
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

  async removeArea(condominiumId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.commonArea.findFirst({
        where: { id, condominiumId },
        include: { inventoryItems: true },
      });
      if (!before) throw new NotFoundException('Common area not found');

      // The CommonArea → InventoryItem relation has no `onDelete` rule (Prisma
      // default `Restrict`); a raw delete of a populated area would surface an
      // unhandled foreign-key error as an HTTP 500. Pre-check the count and
      // fail with a clean 409 instead — never cascade-delete costed items.
      const itemCount = await tx.inventoryItem.count({
        where: { commonAreaId: id, condominiumId },
      });
      if (itemCount > 0) {
        throw new ConflictException(
          `This common area has ${itemCount} inventory item(s). ` +
            'Move or remove them before deleting the area.',
        );
      }

      await tx.commonArea.deleteMany({ where: { id, condominiumId } });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.COMMON_AREA_DELETED,
          actionCategory: 'DELETE',
          module: INVENTORY_MODULE,
          entityType: 'CommonArea',
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

  private async findAreaOrFail(condominiumId: string, id: string) {
    const area = await this.prisma.commonArea.findFirst({
      where: { id, condominiumId },
    });
    if (!area) throw new NotFoundException('Common area not found');
    return area;
  }

  // ─── Inventory Items ──────────────────────────────────────────

  // Builds an explicit, allow-listed Prisma payload from an inventory-item DTO.
  // The DTO (or request body) must never be spread into Prisma `data:` — the
  // allow-list is the structural guarantee that `condominiumId`, `commonAreaId`
  // (handled separately on update), `deletedAt`, or any other unknown key can
  // never be written through a request body (INV-003 mass-assignment guard).
  // Prisma treats `undefined` as "leave unchanged", so the same mapper is safe
  // for both create and partial update.
  private toInventoryItemData(
    dto: CreateInventoryItemDto | UpdateInventoryItemDto,
  ) {
    return {
      name: dto.name,
      category: dto.category,
      brand: dto.brand,
      model: dto.model,
      serialNumber: dto.serialNumber,
      quantity: dto.quantity,
      condition: dto.condition,
      purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
      approximateCost: dto.approximateCost,
      supplier: dto.supplier,
      hasInvoice: dto.hasInvoice,
      invoiceNumber: dto.invoiceNumber,
      notes: dto.notes,
    };
  }

  async findAllItems(
    condominiumId: string,
    query: ListInventoryItemsDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 200;
    const skip = (page - 1) * limit;
    // INV-012: soft-deleted rows are excluded from every read path. The filter
    // is structural — applied here, in findItemOrFail, and in the read-back
    // queries inside update/remove — so deleted items disappear from the API
    // surface while remaining forensically recoverable in the database.
    const where = { condominiumId, deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        include: { commonArea: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.inventoryItem.count({ where }),
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

  async createItem(
    condominiumId: string,
    userId: string,
    dto: CreateInventoryItemDto,
  ) {
    // commonAreaId is re-validated against the caller's tenant before any
    // write — the structural tenant filter on findAreaOrFail is the safety
    // net that prevents an item from being created under another condo's area.
    await this.findAreaOrFail(condominiumId, dto.commonAreaId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryItem.create({
        // `name`, `category` and `commonAreaId` are re-read from the create DTO
        // after the spread so their required types narrow correctly (the shared
        // mapper accepts the partial-update union, which widens them to
        // `T | undefined`). `condominiumId` comes from the guard-derived
        // session value so a request body can never override tenant scope.
        data: {
          ...this.toInventoryItemData(dto),
          name: dto.name,
          category: dto.category,
          commonAreaId: dto.commonAreaId,
          condominiumId,
        },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.INVENTORY_ITEM_CREATED,
          actionCategory: 'CREATE',
          module: INVENTORY_MODULE,
          entityType: 'InventoryItem',
          entityId: created.id,
          afterState: created,
          result: 'SUCCESS',
        },
        tx,
      );

      return created;
    });
  }

  async updateItem(
    condominiumId: string,
    userId: string,
    id: string,
    dto: UpdateInventoryItemDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.inventoryItem.findFirst({
        where: { id, condominiumId, deletedAt: null },
        include: { commonArea: { select: { id: true, name: true } } },
      });
      if (!before) throw new NotFoundException('Inventory item not found');

      // When the caller wants to move an item to a different common area we
      // must re-validate that the target area belongs to the same tenant —
      // CreateInventoryItemDto's @IsString validator only proves the value is
      // a non-empty string, not that it lives inside the caller's condominium.
      if (dto.commonAreaId !== undefined) {
        await this.findAreaOrFail(condominiumId, dto.commonAreaId);
      }

      // updateMany keeps the `{ id, condominiumId, deletedAt: null }` filter
      // structural so tenant scope and soft-delete visibility do not rely on
      // the read above alone. `commonAreaId` is appended outside the
      // allow-listed mapper after re-validation; the mapper never carries it.
      const result = await tx.inventoryItem.updateMany({
        where: { id, condominiumId, deletedAt: null },
        data: {
          ...this.toInventoryItemData(dto),
          ...(dto.commonAreaId !== undefined
            ? { commonAreaId: dto.commonAreaId }
            : {}),
        },
      });
      if (result.count === 0)
        throw new NotFoundException('Inventory item not found');

      const updated = await tx.inventoryItem.findFirst({
        where: { id, condominiumId, deletedAt: null },
        include: { commonArea: { select: { id: true, name: true } } },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.INVENTORY_ITEM_UPDATED,
          actionCategory: 'UPDATE',
          module: INVENTORY_MODULE,
          entityType: 'InventoryItem',
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

  async removeItem(condominiumId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.inventoryItem.findFirst({
        where: { id, condominiumId, deletedAt: null },
        include: { commonArea: { select: { id: true, name: true } } },
      });
      if (!before) throw new NotFoundException('Inventory item not found');

      // INV-012: soft delete. updateMany's `{ id, condominiumId, deletedAt:
      // null }` filter makes tenant isolation structural — it no longer depends
      // on the read above happening first. The row remains in the database for
      // forensic recovery; reads filter `deletedAt` out across the service.
      const result = await tx.inventoryItem.updateMany({
        where: { id, condominiumId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0)
        throw new NotFoundException('Inventory item not found');

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: AUDIT_ACTION.INVENTORY_ITEM_DELETED,
          actionCategory: 'DELETE',
          module: INVENTORY_MODULE,
          entityType: 'InventoryItem',
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

  private async findItemOrFail(condominiumId: string, id: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, condominiumId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }
}

// ─── Common Areas — server-side query builders (CMA-013) ───────────────────────

// Builds the Prisma `where` for the common-areas list. Tenant isolation
// (condominiumId) is always applied and is never derived from request input —
// it comes from the route guard. Text filters use a case-insensitive substring
// match, mirroring the residents-module convention.
function buildCommonAreaWhere(
  condominiumId: string,
  dto: ListCommonAreasDto,
): Prisma.CommonAreaWhereInput {
  const and: Prisma.CommonAreaWhereInput[] = [];

  if (dto.name) {
    and.push({ name: { contains: dto.name, mode: 'insensitive' } });
  }

  if (dto.responsible) {
    and.push({
      responsiblePerson: { contains: dto.responsible, mode: 'insensitive' },
    });
  }

  // `status` is already validated against CommonAreaStatus by the DTO's
  // @IsEnum, so it is safe to apply directly as an exact match.
  if (dto.status) {
    and.push({ status: dto.status });
  }

  return {
    condominiumId,
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

// Maps the validated `sortBy` to a deterministic Prisma `orderBy`. A
// client-supplied value never reaches Prisma directly: the DTO allow-list
// (@IsIn) plus this switch are the two safety layers. `id` is appended as a
// stable tiebreaker so pagination never skips or repeats a row.
function buildCommonAreaOrderBy(
  dto: ListCommonAreasDto,
): Prisma.CommonAreaOrderByWithRelationInput[] {
  const dir: Prisma.SortOrder = dto.sortDirection === 'desc' ? 'desc' : 'asc';
  const tiebreaker: Prisma.CommonAreaOrderByWithRelationInput = { id: 'asc' };

  switch (dto.sortBy) {
    case 'status':
      return [{ status: dir }, tiebreaker];
    case 'responsiblePerson':
      return [{ responsiblePerson: dir }, tiebreaker];
    case 'physicalLocation':
      return [{ physicalLocation: dir }, tiebreaker];
    case 'createdAt':
      return [{ createdAt: dir }, tiebreaker];
    case 'updatedAt':
      return [{ updatedAt: dir }, tiebreaker];
    case 'name':
    default:
      return [{ name: dir }, tiebreaker];
  }
}
