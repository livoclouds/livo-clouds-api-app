import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassificationStatus, Prisma } from '@prisma/client';
import { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

const EXPORT_COLUMN_IDS = [
  'rowNumber',
  'date',
  'description',
  'unit',
  'resident',
  'concept',
  'period',
  'amount',
  'classificationStatus',
  'confidence',
] as const;
type ExportColumnId = (typeof EXPORT_COLUMN_IDS)[number];

const EXPORT_HEADER_LABEL: Record<ExportColumnId, string> = {
  rowNumber:            'Row',
  date:                 'Date',
  description:          'Description',
  unit:                 'Unit',
  resident:             'Resident',
  concept:              'Concept',
  period:               'Period',
  amount:               'Amount',
  classificationStatus: 'Classification',
  confidence:           'Confidence',
};

const EXPORT_MANDATORY_COLUMNS: readonly ExportColumnId[] = ['rowNumber', 'description'];
const EXPORT_HARD_CAP = 50_000;
const EXPORT_CHUNK_SIZE = 1_000;

function escapeCsvValue(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  if (str.length === 0) return '';
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

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

    const safeSortDir = (dto.sortDir === 'asc' || dto.sortDir === 'desc') ? dto.sortDir : 'desc';
    const sortAllowlist: Record<string, Prisma.TransactionOrderByWithRelationInput> = {
      reconciledAt:    { reconciledAt: safeSortDir },
      transactionDate: { transactionDate: safeSortDir },
      paymentConcept:  { paymentConcept: safeSortDir },
      unit:            { resident: { unitNumber: safeSortDir } },
    };
    const orderBy: Prisma.TransactionOrderByWithRelationInput =
      dto.sortBy && sortAllowlist[dto.sortBy]
        ? sortAllowlist[dto.sortBy]
        : { reconciledAt: safeSortDir };

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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

  exportClassifiedCsv(condominiumId: string, dto: ListTransactionsDto): Readable {
    const { flowType, classificationStatus, dateFrom, dateTo, residentId, importBatchId, columns } = dto;

    if (
      classificationStatus !== undefined &&
      classificationStatus !== ClassificationStatus.AUTO &&
      classificationStatus !== ClassificationStatus.MANUAL_OVERRIDE
    ) {
      throw new BadRequestException({
        code: 'INVALID_CLASSIFICATION_STATUS',
        reason: 'Only AUTO and MANUAL_OVERRIDE are accepted on the classified endpoint.',
      });
    }

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

    const resolvedColumns = this.resolveExportColumns(columns);

    return Readable.from(this.streamClassifiedRows(where, resolvedColumns));
  }

  private resolveExportColumns(raw: string | undefined): ExportColumnId[] {
    const allowed = new Set<ExportColumnId>(EXPORT_COLUMN_IDS);
    let requested: ExportColumnId[];

    if (!raw || raw.trim().length === 0) {
      requested = [...EXPORT_COLUMN_IDS];
    } else {
      const ids = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      requested = ids.filter((id): id is ExportColumnId => allowed.has(id as ExportColumnId));
      if (requested.length === 0) {
        requested = [...EXPORT_COLUMN_IDS];
      }
    }

    const mandatory = EXPORT_MANDATORY_COLUMNS.filter((id) => !requested.includes(id));
    return [...mandatory, ...requested.filter((id) => !mandatory.includes(id))];
  }

  private async *streamClassifiedRows(
    where: Prisma.TransactionWhereInput,
    columns: ExportColumnId[],
  ): AsyncGenerator<string> {
    yield '﻿';
    yield columns.map((c) => escapeCsvValue(EXPORT_HEADER_LABEL[c])).join(',') + '\r\n';

    let cursor: string | undefined;
    let exported = 0;
    let truncated = false;

    while (exported < EXPORT_HARD_CAP) {
      const chunk = await this.prisma.transaction.findMany({
        where,
        take: EXPORT_CHUNK_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        include: {
          resident: { select: { id: true, unitNumber: true, firstName: true, lastName: true } },
          matchedRule: { select: { id: true, name: true } },
        },
      });

      if (chunk.length === 0) break;

      for (const tx of chunk) {
        if (exported >= EXPORT_HARD_CAP) {
          truncated = true;
          break;
        }
        exported += 1;
        yield this.buildExportRow(tx, columns, exported) + '\r\n';
      }

      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < EXPORT_CHUNK_SIZE) break;
    }

    if (truncated) {
      yield `# TRUNCATED: results exceeded ${EXPORT_HARD_CAP} rows; refine filters\r\n`;
    }
  }

  async getAuditChain(condominiumId: string, transactionId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId },
      select: { id: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    return this.prisma.auditLog.findMany({
      where: { entityId: transactionId },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private buildExportRow(
    tx: Prisma.TransactionGetPayload<{
      include: {
        resident: { select: { id: true; unitNumber: true; firstName: true; lastName: true } };
        matchedRule: { select: { id: true; name: true } };
      };
    }>,
    columns: ExportColumnId[],
    rowIndex: number,
  ): string {
    return columns
      .map((column) => {
        switch (column) {
          case 'rowNumber':
            return escapeCsvValue(rowIndex);
          case 'date':
            return escapeCsvValue(tx.transactionDate.toISOString().slice(0, 10));
          case 'description':
            return escapeCsvValue(tx.description);
          case 'unit':
            return escapeCsvValue(tx.unitNumberDetected ?? tx.resident?.unitNumber ?? '');
          case 'resident':
            return escapeCsvValue(
              tx.resident ? `${tx.resident.firstName} ${tx.resident.lastName}`.trim() : '',
            );
          case 'concept':
            return escapeCsvValue(tx.paymentConcept ?? '');
          case 'period':
            return escapeCsvValue(
              tx.paymentPeriodYear != null && tx.paymentPeriodMonth != null
                ? `${tx.paymentPeriodYear}-${String(tx.paymentPeriodMonth).padStart(2, '0')}`
                : '',
            );
          case 'amount': {
            const absolute =
              (tx.credits != null ? Number(tx.credits) : null) ??
              (tx.charges != null ? Number(tx.charges) : null) ??
              0;
            const signed = tx.flowType === 'INCOME' ? absolute : -absolute;
            return escapeCsvValue(signed.toFixed(2));
          }
          case 'classificationStatus':
            return escapeCsvValue(tx.classificationStatus);
          case 'confidence':
            return escapeCsvValue(
              tx.confidenceScore != null ? Number(tx.confidenceScore).toFixed(2) : '',
            );
        }
      })
      .join(',');
  }
}
