import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { ListCommonAreasDto } from './dto/list-common-areas.dto';
import { ListInventoryItemsDto } from './dto/list-inventory-items.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';

const INVENTORY_MODULE = 'inventory';

const AUDIT_ACTION = {
  COMMON_AREA_CREATED: 'COMMON_AREA_CREATED',
  COMMON_AREA_UPDATED: 'COMMON_AREA_UPDATED',
  COMMON_AREA_DELETED: 'COMMON_AREA_DELETED',
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
    const where = { condominiumId };

    const [data, total] = await Promise.all([
      this.prisma.commonArea.findMany({
        where,
        include: { inventoryItems: true },
        orderBy: { name: 'asc' },
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
    return {
      name: dto.name,
      nameKey: dto.nameKey,
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

  async findAllItems(
    condominiumId: string,
    query: ListInventoryItemsDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 200;
    const skip = (page - 1) * limit;
    const where = { condominiumId };

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

  async createItem(condominiumId: string, dto: CreateInventoryItemDto) {
    await this.findAreaOrFail(condominiumId, dto.commonAreaId);

    return this.prisma.inventoryItem.create({
      data: {
        ...dto,
        condominiumId,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
      },
    });
  }

  async updateItem(
    condominiumId: string,
    id: string,
    dto: Partial<CreateInventoryItemDto>,
  ) {
    await this.findItemOrFail(condominiumId, id);

    const data = { ...dto } as Record<string, unknown>;
    if (dto.purchaseDate) {
      data.purchaseDate = new Date(dto.purchaseDate);
    }

    const result = await this.prisma.inventoryItem.updateMany({
      where: { id, condominiumId },
      data,
    });
    if (result.count === 0) throw new NotFoundException('Inventory item not found');
    return this.prisma.inventoryItem.findFirst({
      where: { id, condominiumId },
      include: { commonArea: { select: { id: true, name: true } } },
    });
  }

  async removeItem(condominiumId: string, id: string) {
    await this.findItemOrFail(condominiumId, id);
    return this.prisma.inventoryItem.delete({ where: { id } });
  }

  private async findItemOrFail(condominiumId: string, id: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, condominiumId },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }
}
