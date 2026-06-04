import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsCacheService } from '../settings/settings-cache.service';

const PAID_STATUSES = ['PAID_ON_TIME', 'PAID_LATE', 'PARTIAL'] as const;

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private settingsCache: SettingsCacheService,
  ) {}

  async getKpis(condominiumId: string, year: number, month: number) {
    const [incomeAgg, expenseAgg, residentStats, recentTransactions, settings] =
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
        // Phase 6 (A5): currency comes from the tenant-scoped settings cache
        // instead of a dedicated findUnique on every KPI load.
        this.settingsCache.getSettings(condominiumId),
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
      currency: settings?.currency ?? 'MXN',
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

  /**
   * Breakdown of a month's expenses grouped by expense category. Mirrors the
   * getKpis expense filter (all EXPENSE rows by transactionDate, any
   * reconciliation status) so the slices sum to the dashboard's totalExpenses.
   * Transactions with no category fall into an "uncategorized" bucket (null id).
   */
  async getExpensesByCategory(condominiumId: string, year: number, month: number) {
    const gte = new Date(year, month - 1, 1);
    const lt = new Date(year, month, 1);

    const [grouped, categories, settings] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['expenseCategoryId'],
        where: { condominiumId, flowType: 'EXPENSE', transactionDate: { gte, lt } },
        _sum: { charges: true },
        _count: true,
      }),
      // No deletedAt filter: a soft-deleted category still referenced by historical
      // transactions should resolve its name, not fall into "uncategorized".
      this.prisma.expenseCategory.findMany({
        where: { condominiumId },
        select: { id: true, name: true, systemKey: true, color: true },
      }),
      this.settingsCache.getSettings(condominiumId),
    ]);

    const byId = new Map(categories.map((c) => [c.id, c]));
    const items = grouped
      .map((g) => {
        const cat = g.expenseCategoryId ? byId.get(g.expenseCategoryId) : undefined;
        return {
          expenseCategoryId: g.expenseCategoryId,
          name: cat?.name ?? null,
          systemKey: cat?.systemKey ?? null,
          color: cat?.color ?? null,
          total: Number(g._sum.charges ?? 0),
          count: g._count,
        };
      })
      .filter((i) => i.total > 0)
      .sort((a, b) => b.total - a.total);

    const total = items.reduce((sum, i) => sum + i.total, 0);
    return { currency: settings?.currency ?? 'MXN', period: { year, month }, total, items };
  }

  async getMonthlyTrend(condominiumId: string, year: number) {
    type PaidCountRow = { month: number; paidCount: number };

    const [summaries, totalResidents, paidCountRows] = await Promise.all([
      this.prisma.financialMonthlySummary.findMany({
        where: { condominiumId, year },
        orderBy: { month: 'asc' },
      }),
      this.prisma.resident.count({
        where: { condominiumId, deletedAt: null },
      }),
      this.prisma.$queryRaw<PaidCountRow[]>`
        SELECT
          "month"::int AS month,
          COUNT(DISTINCT "residentId")::int AS "paidCount"
        FROM "collection_records"
        WHERE "condominiumId" = ${condominiumId}
          AND "year" = ${year}
          AND "status"::text IN (${Prisma.join([...PAID_STATUSES])})
        GROUP BY "month"
      `,
    ]);

    const paidByMonth = new Map<number, number>();
    for (const row of paidCountRows) {
      paidByMonth.set(row.month, Number(row.paidCount));
    }

    const getCollectionRate = (m: number) =>
      totalResidents > 0
        ? Math.round(((paidByMonth.get(m) ?? 0) / totalResidents) * 1000) / 10
        : 0;

    if (summaries.length > 0) {
      const byMonth = new Map(summaries.map((s) => [s.month, s]));
      return Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const s = byMonth.get(m);
        return {
          month: m,
          income: s ? Number(s.totalIncome) : 0,
          expenses: s ? Number(s.totalExpenses) : 0,
          collectionRate: getCollectionRate(m),
        };
      });
    }

    // Fallback: single aggregation query grouped by month
    type TrendRow = { month: number; income: number; expenses: number };
    const rows = await this.prisma.$queryRaw<TrendRow[]>`
      SELECT
        EXTRACT(MONTH FROM transaction_date)::int AS month,
        COALESCE(SUM(CASE WHEN flow_type = 'INCOME' THEN credits ELSE 0 END), 0)::float  AS income,
        COALESCE(SUM(CASE WHEN flow_type = 'EXPENSE' THEN charges ELSE 0 END), 0)::float AS expenses
      FROM transactions
      WHERE condominium_id = ${condominiumId}
        AND EXTRACT(YEAR FROM transaction_date) = ${year}
      GROUP BY EXTRACT(MONTH FROM transaction_date)
      ORDER BY month
    `;

    const byMonth = new Map(rows.map((r) => [r.month, r]));
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const r = byMonth.get(m);
      return {
        month: m,
        income: r?.income ?? 0,
        expenses: r?.expenses ?? 0,
        collectionRate: getCollectionRate(m),
      };
    });
  }
}
