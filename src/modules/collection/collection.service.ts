import { Injectable, NotFoundException } from '@nestjs/common';
import { CollectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/types';
import { AccountStatementDto } from './dto/account-statement.dto';
import { ListByResidentDto } from './dto/list-by-resident.dto';
import { ListCollectionDto } from './dto/list-collection.dto';

@Injectable()
export class CollectionService {
  constructor(private prisma: PrismaService) {}

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

    const [transactions, txTotal, incomeAgg, collectionRecords, crStatusGroups] = await Promise.all([
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
      this.prisma.transaction.aggregate({
        where: { ...txWhere, flowType: 'INCOME' },
        _sum: { credits: true },
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

    const totalPaid = Number(incomeAgg._sum.credits ?? 0);
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
        balance: totalPaid - totalExpected,
      },
    };
  }

  async update(
    condominiumId: string,
    id: string,
    dto: {
      status?: string;
      amountPaid?: number;
      paymentDate?: string;
      notes?: string;
    },
  ) {
    const record = await this.prisma.collectionRecord.findFirst({
      where: { id, condominiumId },
    });

    if (!record) {
      throw new NotFoundException('Collection record not found');
    }

    return this.prisma.collectionRecord.update({
      where: { id },
      data: {
        status: dto.status ? (dto.status as CollectionStatus) : undefined,
        amountPaid: dto.amountPaid,
        notes: dto.notes,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
      },
    });
  }
}
