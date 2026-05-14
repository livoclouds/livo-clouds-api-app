import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/types';
import { ListCollectionMatrixDto } from './dto/list-collection-matrix.dto';
import { ListOverdueDto } from './dto/list-overdue.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getOverdue(
    condominiumId: string,
    dto: ListOverdueDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 500;
    const skip = (page - 1) * limit;

    const where: Prisma.ResidentWhereInput = {
      condominiumId,
      paymentStatus: 'OVERDUE',
      deletedAt: null,
      ...(dto.q
        ? {
            OR: [
              { unitNumber: { contains: dto.q, mode: 'insensitive' } },
              { firstName: { contains: dto.q, mode: 'insensitive' } },
              { lastName: { contains: dto.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(dto.minDebt !== undefined ? { debt: { gte: dto.minDebt } } : {}),
    };

    const [residents, total] = await Promise.all([
      this.prisma.resident.findMany({
        where,
        include: {
          collectionRecords: {
            where: { status: { in: ['UNPAID', 'PARTIAL'] } },
            orderBy: [{ year: 'asc' }, { month: 'asc' }],
          },
        },
        orderBy: { debt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.resident.count({ where }),
    ]);

    const data = residents.map((r) => ({
      residentId: r.id,
      unitNumber: r.unitNumber,
      name: `${r.firstName} ${r.lastName}`,
      residentType: r.residentType,
      totalDebt: Number(r.debt),
      overdueMonths: r.collectionRecords.length,
      records: r.collectionRecords,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCollectionMatrix(
    condominiumId: string,
    dto: ListCollectionMatrixDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const year = dto.year ?? new Date().getFullYear();
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 500;
    const skip = (page - 1) * limit;

    const where: Prisma.ResidentWhereInput = { condominiumId, deletedAt: null };

    const [residents, total] = await Promise.all([
      this.prisma.resident.findMany({
        where,
        include: {
          collectionRecords: {
            where: { year },
            orderBy: { month: 'asc' },
          },
        },
        orderBy: { unitNumber: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.resident.count({ where }),
    ]);

    const data = residents.map((r) => ({
      residentId: r.id,
      unitNumber: r.unitNumber,
      name: `${r.firstName} ${r.lastName}`,
      residentType: r.residentType,
      paymentStatus: r.paymentStatus,
      debt: Number(r.debt),
      months: r.collectionRecords,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getExecutiveSummary(condominiumId: string, year: number, month: number) {
    const [incomeAgg, expenseAgg, residentStats, collectionStats] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          condominiumId,
          flowType: 'INCOME',
          transactionDate: {
            gte: new Date(year, month - 1, 1),
            lt: new Date(year, month, 1),
          },
        },
        _sum: { credits: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          condominiumId,
          flowType: 'EXPENSE',
          transactionDate: {
            gte: new Date(year, month - 1, 1),
            lt: new Date(year, month, 1),
          },
        },
        _sum: { charges: true },
      }),
      this.prisma.resident.groupBy({
        by: ['paymentStatus'],
        where: { condominiumId, deletedAt: null },
        _count: true,
      }),
      this.prisma.collectionRecord.groupBy({
        by: ['status'],
        where: { condominiumId, year, month },
        _count: true,
      }),
    ]);

    const totalIncome = Number(incomeAgg._sum.credits ?? 0);
    const totalExpenses = Number(expenseAgg._sum.charges ?? 0);
    const netBalance = totalIncome - totalExpenses;

    const currentCount = residentStats.find((s) => s.paymentStatus === 'CURRENT')?._count ?? 0;
    const overdueCount = residentStats.find((s) => s.paymentStatus === 'OVERDUE')?._count ?? 0;
    const totalResidents = currentCount + overdueCount;
    const collectionRate =
      totalResidents > 0 ? Math.round((currentCount / totalResidents) * 100) : 0;

    return {
      period: { year, month },
      totalIncome,
      totalExpenses,
      netBalance,
      collectionRate,
      totalResidents,
      currentResidents: currentCount,
      overdueResidents: overdueCount,
      collectionByStatus: collectionStats,
    };
  }
}
