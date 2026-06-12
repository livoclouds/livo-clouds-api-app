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

const RECONCILED_EXPORT_COLUMN_IDS = [
  'date', 'description', 'payerName', 'amount', 'flowType',
  'reconciliationStatus', 'classificationStatus',
  'resident', 'unit', 'paymentConcept', 'paymentPeriod',
  'reconciledBy', 'reconciledAt', 'importFile',
] as const;
type ReconciledExportColumnId = (typeof RECONCILED_EXPORT_COLUMN_IDS)[number];

const RECONCILED_EXPORT_HEADER_LABEL: Record<ReconciledExportColumnId, string> = {
  date:                 'Date',
  description:          'Description',
  payerName:            'Payer Name',
  amount:               'Amount',
  flowType:             'Flow Type',
  reconciliationStatus: 'Status',
  classificationStatus: 'Classification',
  resident:             'Resident',
  unit:                 'Unit',
  paymentConcept:       'Concept',
  paymentPeriod:        'Period',
  reconciledBy:         'Reconciled By',
  reconciledAt:         'Reconciled At',
  importFile:           'Import File',
};

// ENGINE-036 — spreadsheet formula leads (CWE-1236). A leading =, +, -, @, tab
// or CR makes Excel/Sheets evaluate the cell as a formula when the export is
// opened, so attacker-controlled statement text could execute. Plain numerics
// (e.g. "-123.45") are exempt: they evaluate to themselves and prefixing would
// break the numeric columns of the export.
const FORMULA_LEAD_REGEX = /^[=+\-@\t\r]/;
const PLAIN_NUMERIC_REGEX = /^[+-]?\d+(\.\d+)?$/;

export function escapeCsvValue(input: unknown): string {
  if (input === null || input === undefined) return '';
  let str = String(input);
  if (str.length === 0) return '';
  // Neutralize formula leads independent of the RFC quoting below — quoting
  // alone does not stop spreadsheet formula evaluation.
  if (FORMULA_LEAD_REGEX.test(str) && !PLAIN_NUMERIC_REGEX.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(condominiumId: string, dto: ListTransactionsDto) {
    const { page = 1, limit = 50, flowType, classificationStatus, dateFrom, dateTo, residentId, importBatchId, concept, conceptPresence, unitDetected, description, amountMin, amountMax, importedMinAgeMinutes, importedMaxAgeMinutes } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = { condominiumId };
    if (flowType) where.flowType = flowType;
    if (classificationStatus) where.classificationStatus = classificationStatus;
    if (residentId) where.residentId = residentId;
    if (importBatchId) where.importBatchId = importBatchId;
    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) where.transactionDate.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setUTCHours(23, 59, 59, 999);
        where.transactionDate.lte = end;
      }
    }
    if (concept) where.paymentConcept = { contains: concept, mode: 'insensitive' };
    else if (conceptPresence === 'absent') where.paymentConcept = null;
    // Detected-unit presence filter. A unit can be detected as the scalar
    // (`unitNumberDetected`, 1:1) OR as the multi-house array (`unitNumbersDetected`,
    // scalar null). So "detected" must check BOTH, and "undetected" requires BOTH
    // empty — otherwise multi-house rows (scalar null + array populated) leak into
    // the "Sin detectar" list. The amount filter below owns `where.OR`, so the
    // detected case nests its OR inside `where.AND` to compose via AND.
    if (unitDetected === 'detected') {
      where.AND = [
        { OR: [{ unitNumberDetected: { not: null } }, { unitNumbersDetected: { isEmpty: false } }] },
      ];
    } else if (unitDetected === 'undetected') {
      where.unitNumberDetected = null;
      where.unitNumbersDetected = { isEmpty: true };
    }
    if (description) where.description = { contains: description, mode: 'insensitive' };
    // Amount range filter by absolute magnitude: credits (income) and charges
    // (expense) are stored positive, and a row has exactly one of them set, so
    // matching the range on either column equals "magnitude within range".
    if (amountMin != null || amountMax != null) {
      const range: Prisma.DecimalNullableFilter = {};
      if (amountMin != null) range.gte = amountMin;
      if (amountMax != null) range.lte = amountMax;
      where.OR = [{ credits: range }, { charges: range }];
    }
    // Import-recency window over createdAt, expressed as age in minutes.
    // maxAge → "within the last N" (createdAt >= now - max); minAge → "older
    // than N" (createdAt <= now - min). Both → a band [now-max, now-min].
    if (importedMinAgeMinutes != null || importedMaxAgeMinutes != null) {
      const now = Date.now();
      where.createdAt = {};
      if (importedMaxAgeMinutes != null) where.createdAt.gte = new Date(now - importedMaxAgeMinutes * 60_000);
      if (importedMinAgeMinutes != null) where.createdAt.lte = new Date(now - importedMinAgeMinutes * 60_000);
    }

    const safeSortDir = (dto.sortDir === 'asc' || dto.sortDir === 'desc') ? dto.sortDir : 'desc';
    const sortAllowlist: Record<string, Prisma.TransactionOrderByWithRelationInput | Prisma.TransactionOrderByWithRelationInput[]> = {
      transactionDate: { transactionDate: safeSortDir },
      paymentPeriodYear: [
        { paymentPeriodYear: { sort: safeSortDir, nulls: 'last' } },
        { paymentPeriodMonth: { sort: safeSortDir, nulls: 'last' } },
      ],
      amount: [
        { credits: { sort: safeSortDir, nulls: 'last' } },
        { charges: { sort: safeSortDir, nulls: 'last' } },
      ],
    };
    const orderBy = dto.sortBy && sortAllowlist[dto.sortBy]
      ? sortAllowlist[dto.sortBy]
      : { transactionDate: 'desc' as const };

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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
          // The review tab is backed by findAll; expose split allocations so the
          // edit modal can hydrate them when re-editing a multi-house payment.
          paymentAllocations: {
            select: {
              id: true,
              unitNumber: true,
              residentId: true,
              allocatedAmount: true,
              paymentPeriodYear: true,
              paymentPeriodMonth: true,
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
    const { page = 1, limit = 50, flowType, dateFrom, dateTo, residentId, importBatchId, concept, description } = dto;
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
      if (dateTo) {
        const end = new Date(dateTo);
        end.setUTCHours(23, 59, 59, 999);
        (where.transactionDate as Prisma.DateTimeFilter).lte = end;
      }
    }
    if (concept) where.paymentConcept = { contains: concept, mode: 'insensitive' };
    if (description) where.description = { contains: description, mode: 'insensitive' };

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
          // Multi-unit split payments carry their per-house allocations; the web
          // pre-fills the allocation editor from these when re-editing.
          paymentAllocations: {
            select: {
              id: true,
              unitNumber: true,
              residentId: true,
              allocatedAmount: true,
              paymentPeriodYear: true,
              paymentPeriodMonth: true,
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

  /**
   * ENGINE-038: single where-builder shared by the classified LIST and EXPORT
   * paths. Every new filter lands once — the on-screen table and the CSV can
   * no longer disagree. Includes the status-allowlist guard (identical on both
   * paths before the unification).
   */
  private buildClassifiedWhere(
    condominiumId: string,
    dto: ListTransactionsDto,
  ): Prisma.TransactionWhereInput {
    const {
      flowType, classificationStatus, dateFrom, dateTo, residentId,
      importBatchId, concept, description, unitNumber, residentName,
      period, confidenceLevel,
    } = dto;

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
      if (dateTo) {
        const end = new Date(dateTo);
        end.setUTCHours(23, 59, 59, 999);
        (where.transactionDate as Prisma.DateTimeFilter).lte = end;
      }
    }
    if (concept) where.paymentConcept = { contains: concept, mode: 'insensitive' };
    if (description) where.description = { contains: description, mode: 'insensitive' };
    if (unitNumber || residentName) {
      const residentFilter: Prisma.ResidentWhereInput = {};
      if (unitNumber) {
        residentFilter.unitNumber = { contains: unitNumber, mode: 'insensitive' };
      }
      if (residentName) {
        const parts = residentName.trim().split(/\s+/).filter(Boolean);
        if (parts.length <= 1) {
          residentFilter.OR = [
            { firstName: { contains: residentName.trim(), mode: 'insensitive' } },
            { lastName: { contains: residentName.trim(), mode: 'insensitive' } },
          ];
        } else {
          // Multi-word query: each word must appear in either firstName or lastName.
          // e.g. "Veronica Citlalli Ramirez Ortiz" → firstName="Veronica Citlalli", lastName="Ramirez Ortiz"
          residentFilter.AND = parts.map((part) => ({
            OR: [
              { firstName: { contains: part, mode: 'insensitive' as const } },
              { lastName: { contains: part, mode: 'insensitive' as const } },
            ],
          }));
        }
      }
      where.resident = residentFilter;
    }
    if (period && !dateFrom && !dateTo) {
      const [year, month] = period.split('-').map(Number);
      if (year && month) {
        const periodStart = new Date(Date.UTC(year, month - 1, 1));
        const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
        where.transactionDate = { gte: periodStart, lte: periodEnd };
      }
    }
    if (confidenceLevel === 'HIGH') where.confidenceScore = { gte: 0.8 };
    else if (confidenceLevel === 'MEDIUM') where.confidenceScore = { gte: 0.5, lt: 0.8 };
    else if (confidenceLevel === 'LOW') where.confidenceScore = { lt: 0.5 };

    return where;
  }

  /**
   * ENGINE-038: single where-builder shared by the reconciled LIST and EXPORT
   * paths (same rationale as buildClassifiedWhere).
   */
  private buildReconciledWhere(
    condominiumId: string,
    dto: ListTransactionsDto,
  ): Prisma.TransactionWhereInput {
    const { flowType, dateFrom, dateTo, importBatchId } = dto;
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
      if (dateTo) {
        const end = new Date(dateTo);
        end.setUTCHours(23, 59, 59, 999);
        (where.transactionDate as Prisma.DateTimeFilter).lte = end;
      }
    }
    // ILIKE scan on unindexed columns — acceptable at current dataset size
    if (dto.q && dto.q.trim().length > 0) {
      where.OR = [
        { payerName: { contains: dto.q, mode: 'insensitive' } },
        { description: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  async findClassified(condominiumId: string, dto: ListTransactionsDto) {
    const { page = 1, limit = 50 } = dto;
    const skip = (page - 1) * limit;
    const where = this.buildClassifiedWhere(condominiumId, dto);

    const safeSortDir = (dto.sortDir === 'asc' || dto.sortDir === 'desc') ? dto.sortDir : 'desc';
    const sortAllowlist: Record<string, Prisma.TransactionOrderByWithRelationInput | Prisma.TransactionOrderByWithRelationInput[]> = {
      transactionDate: { transactionDate: safeSortDir },
      paymentPeriodYear: [
        { paymentPeriodYear: { sort: safeSortDir, nulls: 'last' } },
        { paymentPeriodMonth: { sort: safeSortDir, nulls: 'last' } },
      ],
      amount: [
        { credits: { sort: safeSortDir, nulls: 'last' } },
        { charges: { sort: safeSortDir, nulls: 'last' } },
      ],
      unit: { resident: { unitNumber: safeSortDir } },
      confidenceScore: { confidenceScore: { sort: safeSortDir, nulls: 'last' } },
    };
    const orderBy = dto.sortBy && sortAllowlist[dto.sortBy]
      ? sortAllowlist[dto.sortBy]
      : { transactionDate: 'desc' as const };

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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
          // Per-house allocations of a split payment, rendered as chips + the
          // amount each resident was credited.
          paymentAllocations: {
            select: {
              id: true,
              unitNumber: true,
              residentId: true,
              allocatedAmount: true,
              paymentPeriodYear: true,
              paymentPeriodMonth: true,
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
    const { page = 1, limit = 50 } = dto;
    const skip = (page - 1) * limit;
    const where = this.buildReconciledWhere(condominiumId, dto);

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

  /**
   * ENGINE-037: the export stays streamed, but truncation is now an
   * out-of-band, machine-readable signal — a pre-stream count against the
   * shared where (so list/export/count can never diverge) that the controller
   * surfaces as the X-Export-Truncated response header. The old `# TRUNCATED`
   * pseudo-row is gone: Excel parsed it as data and programmatic consumers
   * never saw it.
   */
  async prepareClassifiedExport(
    condominiumId: string,
    dto: ListTransactionsDto,
  ): Promise<{ stream: Readable; truncated: boolean }> {
    const where = this.buildClassifiedWhere(condominiumId, dto);
    const resolvedColumns = this.resolveExportColumns(dto.columns);
    const truncated =
      (await this.prisma.transaction.count({ where })) > EXPORT_HARD_CAP;

    return {
      stream: Readable.from(this.streamClassifiedRows(where, resolvedColumns)),
      truncated,
    };
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
        // ENGINE-037: the hard cap still bounds the body; truncation is
        // signaled via the X-Export-Truncated header, not a pseudo-row.
        if (exported >= EXPORT_HARD_CAP) break;
        exported += 1;
        yield this.buildExportRow(tx, columns, exported) + '\r\n';
      }

      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < EXPORT_CHUNK_SIZE) break;
    }
  }

  async getAuditChain(condominiumId: string, transactionId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId },
      select: { id: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    // ENGINE-056: scope by tenant + entity type, not entityId alone — an
    // id-reusing entity must never leak another tenant's audit history.
    return this.prisma.auditLog.findMany({
      where: { entityId: transactionId, condominiumId, entityType: 'Transaction' },
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

  /** ENGINE-037: same truncation contract as prepareClassifiedExport. */
  async prepareReconciledExport(
    condominiumId: string,
    dto: ListTransactionsDto,
  ): Promise<{ stream: Readable; truncated: boolean }> {
    const where = this.buildReconciledWhere(condominiumId, dto);
    const truncated =
      (await this.prisma.transaction.count({ where })) > EXPORT_HARD_CAP;

    return {
      stream: Readable.from(this.streamReconciledRows(where)),
      truncated,
    };
  }

  private async *streamReconciledRows(
    where: Prisma.TransactionWhereInput,
  ): AsyncGenerator<string> {
    yield '﻿';
    yield RECONCILED_EXPORT_COLUMN_IDS
      .map((c) => escapeCsvValue(RECONCILED_EXPORT_HEADER_LABEL[c]))
      .join(',') + '\r\n';

    let cursor: string | undefined;
    let exported = 0;

    while (exported < EXPORT_HARD_CAP) {
      const chunk = await this.prisma.transaction.findMany({
        where,
        take: EXPORT_CHUNK_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        include: {
          resident: { select: { id: true, unitNumber: true, firstName: true, lastName: true } },
          importBatch: { select: { id: true, fileName: true } },
          reconciledBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      if (chunk.length === 0) break;

      for (const tx of chunk) {
        // ENGINE-037: the hard cap still bounds the body; truncation is
        // signaled via the X-Export-Truncated header, not a pseudo-row.
        if (exported >= EXPORT_HARD_CAP) break;
        exported += 1;
        yield this.buildReconciledExportRow(tx) + '\r\n';
      }

      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < EXPORT_CHUNK_SIZE) break;
    }
  }

  private buildReconciledExportRow(
    tx: Prisma.TransactionGetPayload<{
      include: {
        resident: { select: { id: true; unitNumber: true; firstName: true; lastName: true } };
        importBatch: { select: { id: true; fileName: true } };
        reconciledBy: { select: { id: true; firstName: true; lastName: true } };
      };
    }>,
  ): string {
    const amount = (() => {
      const absolute =
        (tx.credits != null ? Number(tx.credits) : null) ??
        (tx.charges != null ? Number(tx.charges) : null) ??
        0;
      return tx.flowType === 'INCOME' ? absolute : -absolute;
    })();

    const period =
      tx.paymentPeriodYear != null && tx.paymentPeriodMonth != null
        ? `${tx.paymentPeriodYear}-${String(tx.paymentPeriodMonth).padStart(2, '0')}`
        : '';

    const residentName = tx.resident
      ? `${tx.resident.firstName} ${tx.resident.lastName}`.trim()
      : '';

    const reconciledByName = tx.reconciledBy
      ? `${tx.reconciledBy.firstName} ${tx.reconciledBy.lastName}`.trim()
      : '';

    const reconciledAt = tx.reconciledAt
      ? tx.reconciledAt.toISOString().replace('T', ' ').slice(0, 19)
      : '';

    return RECONCILED_EXPORT_COLUMN_IDS.map((column) => {
      switch (column) {
        case 'date':              return escapeCsvValue(tx.transactionDate.toISOString().slice(0, 10));
        case 'description':       return escapeCsvValue(tx.description);
        case 'payerName':         return escapeCsvValue(tx.payerName ?? '');
        case 'amount':            return escapeCsvValue(amount.toFixed(2));
        case 'flowType':          return escapeCsvValue(tx.flowType);
        case 'reconciliationStatus': return escapeCsvValue(tx.reconciliationStatus);
        case 'classificationStatus': return escapeCsvValue(tx.classificationStatus);
        case 'resident':          return escapeCsvValue(residentName);
        case 'unit':              return escapeCsvValue(tx.resident?.unitNumber ?? '');
        case 'paymentConcept':    return escapeCsvValue(tx.paymentConcept ?? '');
        case 'paymentPeriod':     return escapeCsvValue(period);
        case 'reconciledBy':      return escapeCsvValue(reconciledByName);
        case 'reconciledAt':      return escapeCsvValue(reconciledAt);
        case 'importFile':        return escapeCsvValue(tx.importBatch?.fileName ?? '');
      }
    }).join(',');
  }
}
