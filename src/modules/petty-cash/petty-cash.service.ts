import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtPayload, PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsCacheService } from '../settings/settings-cache.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { ListPettyCashDto } from './dto/list-petty-cash.dto';

const MAX_FOLIO_RETRIES = 5;

// Outflow movement types — these are the ones that represent real expenses.
const EXPENSE_MOVEMENT_TYPES = ['EXIT', 'REIMBURSEMENT'] as const;

@Injectable()
export class PettyCashService {
  constructor(
    private prisma: PrismaService,
    private settingsCache: SettingsCacheService,
  ) {}

  async findAll(
    condominiumId: string,
    query: ListPettyCashDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 200;
    const skip = (page - 1) * limit;
    const where = { condominiumId };

    const [data, total] = await Promise.all([
      this.prisma.pettyCashMovement.findMany({
        where,
        include: {
          registeredBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.pettyCashMovement.count({ where }),
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

  /**
   * Expense breakdown by category for a single month, aggregated from petty
   * cash outflows (EXIT / REIMBURSEMENT). Rejected movements are excluded.
   * Powers the dashboard "Petty cash expenses by category" chart — bank
   * transactions carry no real category, so petty cash is the only source of
   * truly categorized expense data.
   */
  async getCategoryBreakdown(
    condominiumId: string,
    year: number,
    month: number,
  ) {
    const [grouped, settings] = await Promise.all([
      this.prisma.pettyCashMovement.groupBy({
        by: ['category'],
        where: {
          condominiumId,
          movementType: { in: [...EXPENSE_MOVEMENT_TYPES] },
          status: { not: 'REJECTED' },
          date: {
            gte: new Date(year, month - 1, 1),
            lt: new Date(year, month, 1),
          },
        },
        _sum: { amount: true },
      }),
      this.settingsCache.getSettings(condominiumId),
    ]);

    const items = grouped
      .map((g) => ({ category: g.category, amount: Number(g._sum.amount ?? 0) }))
      .filter((i) => i.amount > 0);
    const total = items.reduce((acc, i) => acc + i.amount, 0);

    const breakdown = items
      .map((i) => ({
        category: i.category,
        amount: i.amount,
        percentage: total > 0 ? Math.round((i.amount / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      currency: settings?.currency ?? 'MXN',
      period: { year, month },
      total,
      breakdown,
    };
  }

  async findOne(condominiumId: string, id: string) {
    const movement = await this.prisma.pettyCashMovement.findFirst({
      where: { id, condominiumId },
      include: {
        registeredBy: { select: { id: true, firstName: true, lastName: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!movement) {
      throw new NotFoundException('Movement not found');
    }

    return movement;
  }

  async create(condominiumId: string, dto: CreateMovementDto, user: JwtPayload) {
    const lastMovement = await this.prisma.pettyCashMovement.findFirst({
      where: { condominiumId },
      orderBy: { createdAt: 'desc' },
      select: { runningBalance: true },
    });

    const prevBalance = Number(lastMovement?.runningBalance ?? 0);
    const isExit =
      dto.movementType === 'EXIT' || dto.movementType === 'REIMBURSEMENT';
    const runningBalance = isExit
      ? prevBalance - dto.amount
      : prevBalance + dto.amount;

    for (let attempt = 0; attempt < MAX_FOLIO_RETRIES; attempt++) {
      const count = await this.prisma.pettyCashMovement.count({
        where: { condominiumId },
      });
      const folio = `PC-${String(count + 1 + attempt).padStart(4, '0')}`;

      try {
        return await this.prisma.pettyCashMovement.create({
          data: {
            condominiumId,
            folio,
            date: new Date(dto.date),
            movementType: dto.movementType,
            category: dto.category,
            concept: dto.concept,
            amount: dto.amount,
            runningBalance,
            deliveryMethod: dto.deliveryMethod,
            responsible: dto.responsible,
            supplier: dto.supplier,
            hasReceipt: dto.hasReceipt ?? false,
            receiptNumber: dto.receiptNumber,
            authorizedBy: dto.authorizedBy,
            notes: dto.notes,
            registeredById: user.sub,
          },
        });
      } catch (err) {
        const isUniqueFolioViolation =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          Array.isArray(err.meta?.target) &&
          (err.meta!.target as string[]).includes('folio');
        if (!isUniqueFolioViolation) throw err;
      }
    }

    throw new ConflictException(
      'Could not generate unique folio after retries',
    );
  }

  async approve(condominiumId: string, id: string, userId: string) {
    const movement = await this.findOne(condominiumId, id);

    if (movement.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING movements can be approved');
    }

    const result = await this.prisma.pettyCashMovement.updateMany({
      where: { id, condominiumId },
      data: { status: 'APPROVED', updatedById: userId },
    });
    if (result.count === 0) throw new NotFoundException('Movement not found');
    return this.findOne(condominiumId, id);
  }

  async reject(condominiumId: string, id: string, userId: string) {
    const movement = await this.findOne(condominiumId, id);

    if (movement.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING movements can be rejected');
    }

    const result = await this.prisma.pettyCashMovement.updateMany({
      where: { id, condominiumId },
      data: { status: 'REJECTED', updatedById: userId },
    });
    if (result.count === 0) throw new NotFoundException('Movement not found');
    return this.findOne(condominiumId, id);
  }
}
