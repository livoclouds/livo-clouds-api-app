import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(condominiumId: string, dto: ListTransactionsDto) {
    const { page = 1, limit = 50, flowType, classificationStatus, dateFrom, dateTo, residentId, importBatchId } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = { condominiumId };
    if (flowType) where.flowType = flowType;
    if (classificationStatus) where.classificationStatus = classificationStatus;
    if (residentId) where.residentId = residentId;
    if (importBatchId) where.importBatchId = importBatchId;
    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) where.transactionDate.gte = new Date(dateFrom);
      if (dateTo) where.transactionDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { transactionDate: 'desc' },
        include: {
          resident: {
            select: { id: true, unitNumber: true, firstName: true, lastName: true },
          },
          matchedCalendarEvent: {
            select: {
              id: true,
              title: true,
              startDate: true,
              unitNumber: true,
              resident: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
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

  async findUnmatched(condominiumId: string, dto: ListTransactionsDto) {
    const { page = 1, limit = 50, flowType, dateFrom, dateTo, residentId, importBatchId } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = {
      condominiumId,
      classificationStatus: 'NEEDS_REVIEW',
      reconciliationStatus: 'PENDING',
    };
    if (flowType) where.flowType = flowType;
    if (residentId) where.residentId = residentId;
    if (importBatchId) where.importBatchId = importBatchId;
    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) (where.transactionDate as Prisma.DateTimeFilter).gte = new Date(dateFrom);
      if (dateTo) (where.transactionDate as Prisma.DateTimeFilter).lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { transactionDate: 'desc' },
        include: {
          resident: { select: { id: true, unitNumber: true, firstName: true, lastName: true } },
          matchedCalendarEvent: {
            select: {
              id: true,
              title: true,
              startDate: true,
              unitNumber: true,
              resident: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
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

  async findClassified(condominiumId: string, dto: ListTransactionsDto) {
    const { page = 1, limit = 50, flowType, classificationStatus, dateFrom, dateTo, residentId, importBatchId } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = {
      condominiumId,
      classificationStatus: classificationStatus ?? { in: ['AUTO', 'MANUAL_OVERRIDE'] },
      reconciliationStatus: 'PENDING',
    };
    if (flowType) where.flowType = flowType;
    if (residentId) where.residentId = residentId;
    if (importBatchId) where.importBatchId = importBatchId;
    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) (where.transactionDate as Prisma.DateTimeFilter).gte = new Date(dateFrom);
      if (dateTo) (where.transactionDate as Prisma.DateTimeFilter).lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { transactionDate: 'desc' },
        include: {
          resident: { select: { id: true, unitNumber: true, firstName: true, lastName: true } },
          matchedRule: { select: { id: true, name: true } },
          matchedCalendarEvent: {
            select: {
              id: true,
              title: true,
              startDate: true,
              unitNumber: true,
              resident: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
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

  async findReconciled(condominiumId: string, dto: ListTransactionsDto) {
    const { page = 1, limit = 50, flowType, dateFrom, dateTo, importBatchId } = dto;
    const skip = (page - 1) * limit;
    const reconciliationStatus = (dto as ListTransactionsDto & { reconciliationStatus?: string }).reconciliationStatus;

    const where: Prisma.TransactionWhereInput = {
      condominiumId,
      reconciliationStatus: reconciliationStatus
        ? (reconciliationStatus as 'APPROVED' | 'IGNORED')
        : { in: ['APPROVED', 'IGNORED'] },
    };
    if (flowType) where.flowType = flowType;
    if (importBatchId) where.importBatchId = importBatchId;
    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) (where.transactionDate as Prisma.DateTimeFilter).gte = new Date(dateFrom);
      if (dateTo) (where.transactionDate as Prisma.DateTimeFilter).lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { reconciledAt: 'desc' },
        include: {
          resident: { select: { id: true, unitNumber: true, firstName: true, lastName: true } },
          importBatch: { select: { id: true, fileName: true } },
          matchedRule: { select: { id: true, name: true } },
          reconciledBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
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
}
