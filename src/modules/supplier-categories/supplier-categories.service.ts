import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SupplierCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierCategoryDto } from './dto/create-supplier-category.dto';
import { UpdateSupplierCategoryDto } from './dto/update-supplier-category.dto';

@Injectable()
export class SupplierCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    condominiumId: string,
    opts: { includeInactive?: boolean } = {},
  ): Promise<SupplierCategory[]> {
    return this.prisma.supplierCategory.findMany({
      where: {
        condominiumId,
        deletedAt: null,
        ...(opts.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async assertNameFree(
    condominiumId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.supplierCategory.findFirst({
      where: {
        condominiumId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException('supplierCategories.errors.duplicateName');
    }
  }

  private async getOwned(condominiumId: string, id: string): Promise<SupplierCategory> {
    const category = await this.prisma.supplierCategory.findFirst({
      where: { id, condominiumId, deletedAt: null },
    });
    if (!category) {
      throw new NotFoundException('supplierCategories.errors.notFound');
    }
    return category;
  }

  async create(
    condominiumId: string,
    dto: CreateSupplierCategoryDto,
    actorUserId?: string,
  ): Promise<SupplierCategory> {
    const name = dto.name.trim();
    await this.assertNameFree(condominiumId, name);

    const last = await this.prisma.supplierCategory.findFirst({
      where: { condominiumId, deletedAt: null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.supplierCategory.create({
      data: {
        condominiumId,
        name,
        color: dto.color ?? '#6366f1',
        icon: dto.icon ?? 'briefcase',
        isActive: dto.isActive ?? true,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdBy: actorUserId ?? null,
        updatedBy: actorUserId ?? null,
      },
    });
  }

  async update(
    condominiumId: string,
    id: string,
    dto: UpdateSupplierCategoryDto,
    actorUserId?: string,
  ): Promise<SupplierCategory> {
    const existing = await this.getOwned(condominiumId, id);

    const data: Prisma.SupplierCategoryUpdateInput = { updatedBy: actorUserId ?? null };
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.assertNameFree(condominiumId, name, existing.id);
      data.name = name;
    }
    if (dto.color !== undefined) data.color = dto.color || '#6366f1';
    if (dto.icon !== undefined) data.icon = dto.icon || 'briefcase';
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.supplierCategory.update({ where: { id: existing.id }, data });
  }

  async reorder(
    condominiumId: string,
    categoryIds: string[],
    actorUserId?: string,
  ): Promise<SupplierCategory[]> {
    const current = await this.prisma.supplierCategory.findMany({
      where: { condominiumId, deletedAt: null },
      select: { id: true },
    });
    const currentIds = new Set(current.map((c) => c.id));
    const incoming = new Set(categoryIds);
    if (
      currentIds.size !== incoming.size ||
      [...currentIds].some((cid) => !incoming.has(cid))
    ) {
      throw new BadRequestException('supplierCategories.errors.reorderMismatch');
    }

    await this.prisma.$transaction(
      categoryIds.map((cid, index) =>
        this.prisma.supplierCategory.update({
          where: { id: cid },
          data: { sortOrder: index, updatedBy: actorUserId ?? null },
        }),
      ),
    );
    return this.findAll(condominiumId, { includeInactive: true });
  }

  async remove(condominiumId: string, id: string, actorUserId?: string): Promise<void> {
    const existing = await this.getOwned(condominiumId, id);
    await this.prisma.supplierCategory.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: actorUserId ?? null },
    });
  }
}
