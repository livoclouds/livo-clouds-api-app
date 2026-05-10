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
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findUnmatched(condominiumId: string, dto: ListTransactionsDto) {
    return this.findAll(condominiumId, {
      ...dto,
      classificationStatus: 'NEEDS_REVIEW',
    });
  }
}
