import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // ─── Common Areas ──────────────────────────────────────────────

  async findAllAreas(condominiumId: string) {
    return this.prisma.commonArea.findMany({
      where: { condominiumId },
      include: { inventoryItems: true },
      orderBy: { name: 'asc' },
    });
  }

  async createArea(condominiumId: string, dto: CreateCommonAreaDto) {
    return this.prisma.commonArea.create({
      data: { ...dto, condominiumId },
    });
  }

  async updateArea(condominiumId: string, id: string, dto: Partial<CreateCommonAreaDto>) {
    const result = await this.prisma.commonArea.updateMany({
      where: { id, condominiumId },
      data: dto,
    });
    if (result.count === 0) throw new NotFoundException('Common area not found');
    return this.prisma.commonArea.findFirst({ where: { id, condominiumId }, include: { inventoryItems: true } });
  }

  async removeArea(condominiumId: string, id: string) {
    await this.findAreaOrFail(condominiumId, id);
    return this.prisma.commonArea.delete({ where: { id } });
  }

  private async findAreaOrFail(condominiumId: string, id: string) {
    const area = await this.prisma.commonArea.findFirst({
      where: { id, condominiumId },
    });
    if (!area) throw new NotFoundException('Common area not found');
    return area;
  }

  // ─── Inventory Items ──────────────────────────────────────────

  async findAllItems(condominiumId: string) {
    return this.prisma.inventoryItem.findMany({
      where: { condominiumId },
      include: { commonArea: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
