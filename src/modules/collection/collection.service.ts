import { Injectable, NotFoundException } from '@nestjs/common';
import { CollectionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface AccountStatementFilters {
  from?: string;
  to?: string;
  year?: number;
  month?: number;
}

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
    filters: AccountStatementFilters,
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

    const txWhere: any = { condominiumId, residentId };
    if (filters.from || filters.to) {
      txWhere.transactionDate = {};
      if (filters.from) txWhere.transactionDate.gte = new Date(filters.from);
      if (filters.to) txWhere.transactionDate.lte = new Date(filters.to);
    }

    const crWhere: any = { condominiumId, residentId };
    if (filters.year) crWhere.year = filters.year;
    if (filters.month) crWhere.month = filters.month;

    const [transactions, collectionRecords] = await Promise.all([
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
      }),
      this.prisma.collectionRecord.findMany({
        where: crWhere,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
    ]);

    const totalPaid = transactions
      .filter((t) => t.flowType === 'INCOME')
      .reduce((sum, t) => sum + Number(t.credits ?? 0), 0);
    const totalExpected = collectionRecords.reduce(
      (sum, r) => sum + Number(r.amountExpected), 0,
    );
    const monthsPaid = collectionRecords.filter(
      (r) => r.status === 'PAID_ON_TIME' || r.status === 'PAID_LATE',
    ).length;
    const monthsUnpaid = collectionRecords.filter(
      (r) => r.status === 'UNPAID' || r.status === 'PENDING',
    ).length;

    return {
      resident,
      transactions,
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
