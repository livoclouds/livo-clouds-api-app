import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getKpis(condominiumId: string, year: number, month: number) {
    const [incomeAgg, expenseAgg, residentStats, recentTransactions] =
      await Promise.all([
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
          _count: true,
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
          _count: true,
        }),
        this.prisma.resident.groupBy({
          by: ['paymentStatus'],
          where: { condominiumId, deletedAt: null },
          _count: true,
        }),
        this.prisma.transaction.findMany({
          where: { condominiumId },
          orderBy: { transactionDate: 'desc' },
          take: 20,
          include: {
            resident: { select: { unitNumber: true, firstName: true, lastName: true } },
          },
        }),
      ]);

    const totalIncome = Number(incomeAgg._sum.credits ?? 0);
    const totalExpenses = Number(expenseAgg._sum.charges ?? 0);
    const netBalance = totalIncome - totalExpenses;

    const currentResidents =
      residentStats.find((s) => s.paymentStatus === 'CURRENT')?._count ?? 0;
    const overdueResidents =
      residentStats.find((s) => s.paymentStatus === 'OVERDUE')?._count ?? 0;
    const totalResidents = currentResidents + overdueResidents;
    const collectionRate =
      totalResidents > 0
        ? Math.round((currentResidents / totalResidents) * 100)
        : 0;

    return {
      period: { year, month },
      kpis: {
        totalIncome,
        totalExpenses,
        netBalance,
        collectionRate,
        currentResidents,
        overdueResidents,
        totalResidents,
      },
      recentActivity: recentTransactions,
    };
  }

  async getMonthlyTrend(condominiumId: string, year: number) {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    const rows = await Promise.all(
      months.map(async (month) => {
        const [income, expense] = await Promise.all([
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
        ]);

        return {
          month,
          income: Number(income._sum.credits ?? 0),
          expenses: Number(expense._sum.charges ?? 0),
        };
      }),
    );

    return rows;
  }
}
