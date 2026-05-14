import { Injectable, NotFoundException } from '@nestjs/common';
import { CollectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountStatementDto } from './dto/account-statement.dto';

@Injectable()
export class CollectionService {
  constructor(private prisma: PrismaService) {}

  async findAll(condominiumId: string, year: number) {
    return this.prisma.collectionRecord.findMany({
      where: { condominiumId, year },
      include: {
        resident: {
          select: { id: true, unitNumber: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ month: 'asc' }],
    });
  }

  async findByResident(condominiumId: string, residentId: string) {
    return this.prisma.collectionRecord.findMany({
      where: { condominiumId, residentId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
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

    const [transactions, txTotal, incomeAgg, collectionRecords] = await Promise.all([
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
      }),
    ]);

    const totalPaid = Number(incomeAgg._sum.credits ?? 0);
    const totalExpected = collectionRecords.reduce(
      (sum, r) => sum + Number(r.amountExpected),
      0,
    );
    const monthsPaid = collectionRecords.filter(
      (r) => r.status === 'PAID_ON_TIME' || r.status === 'PAID_LATE',
    ).length;
    const monthsUnpaid = collectionRecords.filter(
      (r) => r.status === 'UNPAID' || r.status === 'PENDING',
    ).length;

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
