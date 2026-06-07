import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/types';
import { AuditService } from '../audit/audit.service';
import { AccountStatementDto } from './dto/account-statement.dto';
import { ListByResidentDto } from './dto/list-by-resident.dto';
import { ListCollectionDto } from './dto/list-collection.dto';
import { UpdateCollectionRecordDto } from './dto/update-collection-record.dto';
import {
  buildScoreHistory,
  computeFinancialHealth,
  HealthFactorKey,
  ScoreRecordInput,
} from './financial-health.util';

const COLLECTION_MODULE = 'collection';

@Injectable()
export class CollectionService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll(
    condominiumId: string,
    dto: ListCollectionDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const year = dto.year ?? new Date().getFullYear();
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 600;
    const skip = (page - 1) * limit;

    const where: Prisma.CollectionRecordWhereInput = { condominiumId, year };

    const [data, total] = await Promise.all([
      this.prisma.collectionRecord.findMany({
        where,
        include: {
          resident: {
            select: { id: true, unitNumber: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ month: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.collectionRecord.count({ where }),
    ]);

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

  async findByResident(
    condominiumId: string,
    residentId: string,
    dto: ListByResidentDto = {},
  ): Promise<PaginatedResult<unknown>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.CollectionRecordWhereInput = {
      condominiumId,
      residentId,
    };

    const [data, total] = await Promise.all([
      this.prisma.collectionRecord.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.collectionRecord.count({ where }),
    ]);

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

  async getAccountStatement(
    condominiumId: string,
    residentId: string,
    dto: AccountStatementDto = {},
  ) {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
      select: {
        id: true,
        unitNumber: true,
        firstName: true,
        lastName: true,
        debt: true,
        monthlyFee: true,
        paymentStatus: true,
      },
    });
    if (!resident) throw new NotFoundException('Resident not found');

    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (dto.from || dto.to) {
      if (dto.from) fromDate = new Date(dto.from);
      if (dto.to) toDate = new Date(dto.to);
    } else {
      toDate = new Date();
      fromDate = new Date(toDate);
      fromDate.setMonth(fromDate.getMonth() - 12);
    }

    const txWhere: Prisma.TransactionWhereInput = { condominiumId, residentId };
    if (fromDate || toDate) {
      txWhere.transactionDate = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      };
    }

    const crWhere: Prisma.CollectionRecordWhereInput = { condominiumId, residentId };
    if (dto.year) crWhere.year = dto.year;
    if (dto.month) crWhere.month = dto.month;

    const txPage = dto.txPage ?? 1;
    const txLimit = dto.txLimit ?? 200;
    const txSkip = (txPage - 1) * txLimit;

    const crPage = dto.crPage ?? 1;
    const crLimit = dto.crLimit ?? 24;
    const crSkip = (crPage - 1) * crLimit;

    // Split payments ("casas 307 y 43") carry no single residentId; each resident
    // is credited their slice via a PaymentAllocation. To avoid double-counting we
    // PARTITION the paid total: a transaction WITH allocations contributes only
    // through its allocations; a transaction WITHOUT allocations contributes via
    // credits + residentId as before. The two buckets are mutually exclusive.
    const txDateFilter = txWhere.transactionDate;

    const [transactions, txTotal, incomeAgg, allocationAgg, collectionRecords, crStatusGroups] = await Promise.all([
      this.prisma.transaction.findMany({
        where: txWhere,
        orderBy: { transactionDate: 'desc' },
        select: {
          id: true,
          transactionDate: true,
          description: true,
          credits: true,
          charges: true,
          balance: true,
          flowType: true,
          paymentConcept: true,
          paymentPeriodYear: true,
          paymentPeriodMonth: true,
          matchSource: true,
          confidenceScore: true,
          classificationStatus: true,
          reference: true,
        },
        skip: txSkip,
        take: txLimit,
      }),
      this.prisma.transaction.count({ where: txWhere }),
      // Direct bucket: income directly linked to this resident, excluding any
      // transaction that was split into allocations.
      this.prisma.transaction.aggregate({
        where: { ...txWhere, flowType: 'INCOME', paymentAllocations: { none: {} } },
        _sum: { credits: true },
      }),
      // Allocation bucket: this resident's slices of split payments.
      this.prisma.paymentAllocation.aggregate({
        where: {
          condominiumId,
          residentId,
          ...(txDateFilter ? { transaction: { transactionDate: txDateFilter } } : {}),
        },
        _sum: { allocatedAmount: true },
      }),
      this.prisma.collectionRecord.findMany({
        where: crWhere,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip: crSkip,
        take: crLimit,
      }),
      // Status counts and expected-amount sum are computed at the DB level over
      // the FULL filtered set (independent of the bounded list above), so the
      // summary stays exact regardless of crPage/crLimit.
      this.prisma.collectionRecord.groupBy({
        by: ['status'],
        where: crWhere,
        _count: { _all: true },
        _sum: { amountExpected: true },
      }),
    ]);

    const totalPaid =
      Number(incomeAgg._sum.credits ?? 0) + Number(allocationAgg._sum.allocatedAmount ?? 0);
    const totalExpected = crStatusGroups.reduce(
      (sum, g) => sum + Number(g._sum.amountExpected ?? 0),
      0,
    );
    const monthsPaid = crStatusGroups
      .filter((g) => g.status === 'PAID_ON_TIME' || g.status === 'PAID_LATE')
      .reduce((sum, g) => sum + g._count._all, 0);
    const monthsUnpaid = crStatusGroups
      .filter((g) => g.status === 'UNPAID' || g.status === 'PENDING')
      .reduce((sum, g) => sum + g._count._all, 0);

    return {
      resident,
      transactions: {
        data: transactions,
        meta: {
          total: txTotal,
          page: txPage,
          limit: txLimit,
          totalPages: Math.ceil(txTotal / txLimit),
        },
      },
      collectionRecords,
      summary: {
        totalPaid,
        totalExpected,
        monthsPaid,
        monthsUnpaid,
        // Outstanding debt: POSITIVE = the resident owes, negative = credit. The
        // whole profile (Balance KPI, headline status, health score) reads it
        // this way; computing it as paid − expected inverted the sign for every
        // consumer (Capa 1 bug, fixed in Fase 3).
        balance: totalExpected - totalPaid,
        // Share of the amount expected "as of today" that has been settled, in
        // percent (0–100+). Computed server-side over the same filtered window as
        // totalPaid/totalExpected so the web only renders it (no client-side
        // financial math). Null when nothing is expected yet (no history) — the
        // web shows a dash instead of a misleading 0%.
        compliancePercent: totalExpected > 0 ? (totalPaid / totalExpected) * 100 : null,
      },
    };
  }

  // Explainable financial-health score (Fase 3) + a derived per-month history.
  // The scorer lives server-side now (the web only renders the DTO). Reads the
  // resident's full collection history once and computes both the current score
  // and the trend line from it — no new storage. Same tenant gate as the account
  // statement (controller-level CondominiumAccessGuard).
  async getFinancialHealth(
    condominiumId: string,
    residentId: string,
    historyMonths = 12,
  ) {
    const statement = await this.getAccountStatement(condominiumId, residentId, {
      crPage: 1,
      crLimit: 1000,
    });
    const records: ScoreRecordInput[] = statement.collectionRecords.map((r) => ({
      year: r.year,
      month: r.month,
      status: r.status,
      amountPaid: Number(r.amountPaid),
      amountExpected: Number(r.amountExpected),
    }));
    const now = new Date();
    // Per-condominium score weights (Fase 4) — null/invalid falls back to the
    // documented defaults inside the scorer (normalizeWeights).
    const settings = await this.prisma.condominiumSettings.findUnique({
      where: { condominiumId },
      select: { financialHealthWeights: true },
    });
    const weights = (settings?.financialHealthWeights ?? undefined) as
      | Record<HealthFactorKey, number>
      | undefined;
    const health = computeFinancialHealth(statement.summary, records, now, weights);
    const months = Math.min(36, Math.max(1, Math.floor(historyMonths || 12)));
    const history = buildScoreHistory(records, months, now, weights);
    return {
      current: { ...health, computedAt: now.toISOString() },
      history,
    };
  }

  async update(
    condominiumId: string,
    userId: string,
    id: string,
    dto: UpdateCollectionRecordDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.collectionRecord.findFirst({
        where: { id, condominiumId },
      });

      if (!before) throw new NotFoundException('Collection record not found');

      const updated = await tx.collectionRecord.update({
        where: { id },
        data: {
          status: dto.status,
          amountPaid: dto.amountPaid,
          notes: dto.notes,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
        },
      });

      await this.audit.log(
        {
          condominiumId,
          userId,
          action: 'COLLECTION_RECORD_UPDATED',
          actionCategory: 'FINANCIAL',
          module: COLLECTION_MODULE,
          entityType: 'CollectionRecord',
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
}
