import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReconciliationRuleDto } from './dto/create-reconciliation-rule.dto';
import { UpdateReconciliationRuleDto } from './dto/update-reconciliation-rule.dto';
import { ListReconciliationRulesDto } from './dto/list-reconciliation-rules.dto';

@Injectable()
export class ReconciliationRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(condominiumId: string, dto: ListReconciliationRulesDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.ReconciliationRuleWhereInput = { condominiumId };
    if (dto.isActive !== undefined) where.isActive = dto.isActive;

    const [data, total] = await Promise.all([
      this.prisma.reconciliationRule.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.reconciliationRule.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findActive(condominiumId: string) {
    return this.prisma.reconciliationRule.findMany({
      where: { condominiumId, isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(condominiumId: string, dto: CreateReconciliationRuleDto) {
    return this.prisma.reconciliationRule.create({
      data: {
        condominiumId,
        name: dto.name,
        keywords: dto.keywords,
        unitPatterns: dto.unitPatterns ?? [],
        conceptType: dto.conceptType ?? null,
        confidenceThreshold: dto.confidenceThreshold !== undefined
          ? new Prisma.Decimal(dto.confidenceThreshold.toFixed(2))
          : new Prisma.Decimal('0.80'),
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(condominiumId: string, id: string, dto: UpdateReconciliationRuleDto) {
    await this.findOneOrFail(condominiumId, id);

    const data: Prisma.ReconciliationRuleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.keywords !== undefined) data.keywords = dto.keywords;
    if (dto.unitPatterns !== undefined) data.unitPatterns = dto.unitPatterns;
    if (dto.conceptType !== undefined) data.conceptType = dto.conceptType;
    if (dto.confidenceThreshold !== undefined)
      data.confidenceThreshold = new Prisma.Decimal(dto.confidenceThreshold.toFixed(2));
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.reconciliationRule.update({ where: { id }, data });
  }

  async toggleActive(condominiumId: string, id: string) {
    const rule = await this.findOneOrFail(condominiumId, id);
    return this.prisma.reconciliationRule.update({
      where: { id },
      data: { isActive: !rule.isActive },
    });
  }

  async remove(condominiumId: string, id: string) {
    await this.findOneOrFail(condominiumId, id);
    await this.prisma.reconciliationRule.delete({ where: { id } });
  }

  private async findOneOrFail(condominiumId: string, id: string) {
    const rule = await this.prisma.reconciliationRule.findFirst({
      where: { id, condominiumId },
    });
    if (!rule) throw new NotFoundException('Reconciliation rule not found');
    return rule;
  }
}
