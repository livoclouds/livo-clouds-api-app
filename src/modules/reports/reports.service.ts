import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getOverdue(condominiumId: string) {
    const residents = await this.prisma.resident.findMany({
      where: { condominiumId, paymentStatus: 'OVERDUE', deletedAt: null },
      include: {
        collectionRecords: {
          where: { status: { in: ['UNPAID', 'PARTIAL'] } },
          orderBy: [{ year: 'asc' }, { month: 'asc' }],
        },
      },
      orderBy: { debt: 'desc' },
    });

    return residents.map((r) => ({
      residentId: r.id,
      unitNumber: r.unitNumber,
      name: `${r.firstName} ${r.lastName}`,
      residentType: r.residentType,
      totalDebt: Number(r.debt),
      overdueMonths: r.collectionRecords.length,
      records: r.collectionRecords,
    }));
  }

  async getCollectionMatrix(condominiumId: string, year: number) {
    const residents = await this.prisma.resident.findMany({
      where: { condominiumId, deletedAt: null },
      include: {
        collectionRecords: {
          where: { year },
          orderBy: { month: 'asc' },
        },
      },
      orderBy: { unitNumber: 'asc' },
    });

    return residents.map((r) => ({
      residentId: r.id,
      unitNumber: r.unitNumber,
      name: `${r.firstName} ${r.lastName}`,
      residentType: r.residentType,
      paymentStatus: r.paymentStatus,
      debt: Number(r.debt),
      months: r.collectionRecords,
    }));
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
