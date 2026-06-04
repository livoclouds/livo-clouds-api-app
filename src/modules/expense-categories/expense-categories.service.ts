import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** All non-deleted categories for the tenant, ordered for display. */
  async findAll(
    condominiumId: string,
    opts: { includeInactive?: boolean } = {},
  ): Promise<ExpenseCategory[]> {
    return this.prisma.expenseCategory.findMany({
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
    const clash = await this.prisma.expenseCategory.findFirst({
      where: {
        condominiumId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException('expenseCategories.errors.duplicateName');
    }
  }

  private async getOwned(
    condominiumId: string,
    id: string,
  ): Promise<ExpenseCategory> {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id, condominiumId, deletedAt: null },
    });
    if (!category) {
      throw new NotFoundException('expenseCategories.errors.notFound');
    }
    return category;
  }

  async create(
    condominiumId: string,
    dto: CreateExpenseCategoryDto,
    actorUserId?: string,
  ): Promise<ExpenseCategory> {
    const name = dto.name.trim();
    await this.assertNameFree(condominiumId, name);

    const last = await this.prisma.expenseCategory.findFirst({
      where: { condominiumId, deletedAt: null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.expenseCategory.create({
      data: {
        condominiumId,
        name,
        color: dto.color ?? null,
        isActive: dto.isActive ?? true,
        isSystem: false,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdBy: actorUserId ?? null,
        updatedBy: actorUserId ?? null,
      },
    });
  }

  async update(
    condominiumId: string,
    id: string,
    dto: UpdateExpenseCategoryDto,
    actorUserId?: string,
  ): Promise<ExpenseCategory> {
    const existing = await this.getOwned(condominiumId, id);

    const data: Prisma.ExpenseCategoryUpdateInput = { updatedBy: actorUserId ?? null };
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.assertNameFree(condominiumId, name, existing.id);
      data.name = name;
    }
    if (dto.color !== undefined) data.color = dto.color || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.expenseCategory.update({ where: { id: existing.id }, data });
  }

  /** Persist a new display order. Every non-deleted category must be present once. */
  async reorder(
    condominiumId: string,
    categoryIds: string[],
    actorUserId?: string,
  ): Promise<ExpenseCategory[]> {
    const current = await this.prisma.expenseCategory.findMany({
      where: { condominiumId, deletedAt: null },
      select: { id: true },
    });
    const currentIds = new Set(current.map((c) => c.id));
    const incoming = new Set(categoryIds);
    if (
      currentIds.size !== incoming.size ||
      [...currentIds].some((cid) => !incoming.has(cid))
    ) {
      throw new BadRequestException('expenseCategories.errors.reorderMismatch');
    }

    await this.prisma.$transaction(
      categoryIds.map((cid, index) =>
        this.prisma.expenseCategory.update({
          where: { id: cid },
          data: { sortOrder: index, updatedBy: actorUserId ?? null },
        }),
      ),
    );
    return this.findAll(condominiumId, { includeInactive: true });
  }

  /**
   * Soft-delete a category. System (seeded) categories cannot be deleted — they
   * may only be deactivated. Existing transactions/rules keep pointing at the row
   * (it is not hard-deleted), so historical labels still resolve.
   */
  async remove(
    condominiumId: string,
    id: string,
    actorUserId?: string,
  ): Promise<void> {
    const existing = await this.getOwned(condominiumId, id);
    if (existing.isSystem) {
      throw new BadRequestException('expenseCategories.errors.systemUndeletable');
    }
    await this.prisma.expenseCategory.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: actorUserId ?? null },
    });
  }
}
