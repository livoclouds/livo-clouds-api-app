import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClassificationService } from '../classification/classification.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { ListImportBatchesDto } from './dto/list-import-batches.dto';

const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_ROWS_PER_IMPORT = 10_000; // CLAUDE.md §19

function isXlsxMagicBytes(buffer: Buffer): boolean {
  // XLSX is a ZIP archive — starts with PK\x03\x04
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

function isPdfMagicBytes(buffer: Buffer): boolean {
  // PDF starts with %PDF
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  );
}

// CLAUDE.md §11 Stage 3 — abort if the ratio of domain-invalid rows exceeds 30 %.
const INVALID_ROWS_THRESHOLD = 0.30;

export type RowErrorField =
  | 'date'
  | 'charges'
  | 'credits'
  | 'description'
  | 'flowType';

export interface RowError {
  rowIndex: number;
  field: RowErrorField;
  message: string;
}

export interface ValidationReport {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  invalidRatio: number;
  errors: RowError[];
}

interface ParsedRow {
  date: string;
  description: string;
  charges: number;
  credits: number;
  balance: number;
  flowType: 'income' | 'expense';
  transactionNumber?: string;
  time?: string;
  receipt?: string;
}

function validateRows<T extends ParsedRow>(
  rows: T[],
): { valid: T[]; report: ValidationReport } {
  const errors: RowError[] = [];
  const valid: T[] = [];
  const now = Date.now();
  const fiveYearsAgo = now - 5 * 365 * 24 * 60 * 60 * 1000;

  rows.forEach((row, rowIndex) => {
    const rowErrors: RowError[] = [];

    const parsedDate = row.date ? new Date(row.date) : new Date(NaN);
    if (Number.isNaN(parsedDate.getTime())) {
      rowErrors.push({ rowIndex, field: 'date', message: 'Invalid date format' });
    } else {
      const ts = parsedDate.getTime();
      if (ts > now) {
        rowErrors.push({ rowIndex, field: 'date', message: 'Date is in the future' });
      } else if (ts < fiveYearsAgo) {
        rowErrors.push({ rowIndex, field: 'date', message: 'Date is more than 5 years in the past' });
      }
    }

    if (!Number.isFinite(row.charges) || row.charges < 0) {
      rowErrors.push({ rowIndex, field: 'charges', message: 'Charges must be a finite, non-negative number' });
    }
    if (!Number.isFinite(row.credits) || row.credits < 0) {
      rowErrors.push({ rowIndex, field: 'credits', message: 'Credits must be a finite, non-negative number' });
    }

    if (!row.description || row.description.trim().length === 0) {
      rowErrors.push({ rowIndex, field: 'description', message: 'Description is required' });
    }

    if (row.flowType !== 'income' && row.flowType !== 'expense') {
      rowErrors.push({ rowIndex, field: 'flowType', message: "flowType must be 'income' or 'expense'" });
    }

    if (rowErrors.length === 0) {
      valid.push(row);
    } else {
      errors.push(...rowErrors);
    }
  });

  const totalRows = rows.length;
  const validRows = valid.length;
  const invalidRows = totalRows - validRows;
  const invalidRatio = totalRows === 0 ? 0 : invalidRows / totalRows;

  return {
    valid,
    report: { totalRows, validRows, invalidRows, invalidRatio, errors },
  };
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly classification: ClassificationService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async findAll(condominiumId: string, dto: ListImportBatchesDto) {
    const { page = 1, limit = 15, fileName, fileType, status, dateFrom, dateTo } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.ImportBatchWhereInput = { condominiumId };
    if (fileName) where.fileName = { contains: fileName, mode: 'insensitive' };
    if (fileType) where.fileType = fileType;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.importBatch.findMany({
        where,
        include: {
          importedBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { transactions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.importBatch.count({ where }),
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

  async findOne(condominiumId: string, id: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, condominiumId },
      include: {
        importedBy: { select: { id: true, firstName: true, lastName: true } },
        transactions: { take: 50, orderBy: { transactionDate: 'desc' } },
      },
    });

    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    return batch;
  }

  async upload(
    condominiumId: string,
    files: { buffer: Buffer; originalname: string; mimetype: string; size: number }[],
    user: JwtPayload,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    if (files.length > 5) {
      throw new BadRequestException('Maximum 5 files per upload');
    }

    await this.audit.log({
      condominiumId,
      userId: user.sub,
      action: 'IMPORT_STARTED',
      actionCategory: 'CREATE',
      module: 'imports',
      entityType: 'ImportBatch',
      result: 'SUCCESS',
      afterState: {
        fileCount: files.length,
        fileNames: files.map((f) => f.originalname),
        fileSizes: files.map((f) => f.size),
      },
    });

    type FilePlan =
      | { kind: 'error'; result: Record<string, unknown> }
      | {
          kind: 'eligible';
          file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
          fileHash: string;
        };

    const plans: FilePlan[] = files.map((file) => {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return {
          kind: 'error',
          result: {
            fileName: file.originalname,
            status: 'error',
            message: 'Invalid file type. Only PDF and XLSX are allowed.',
          },
        };
      }
      // Defense-in-depth: file.mimetype is the client-supplied multipart header.
      // Verify against the first bytes of the buffer so direct API callers cannot
      // bypass the Next.js proxy magic-byte check by lying about Content-Type.
      const declaredXlsx = file.mimetype.includes('spreadsheetml');
      const declaredPdf = file.mimetype.includes('pdf');
      if (declaredXlsx && !isXlsxMagicBytes(file.buffer)) {
        return {
          kind: 'error',
          result: {
            fileName: file.originalname,
            status: 'error',
            message: 'File content does not match a valid Excel format.',
          },
        };
      }
      if (declaredPdf && !isPdfMagicBytes(file.buffer)) {
        return {
          kind: 'error',
          result: {
            fileName: file.originalname,
            status: 'error',
            message: 'File content does not match a valid PDF format.',
          },
        };
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return {
          kind: 'error',
          result: {
            fileName: file.originalname,
            status: 'error',
            message: 'File exceeds 20MB limit',
          },
        };
      }
      const fileHash = crypto
        .createHash('sha256')
        .update(file.buffer)
        .digest('hex');
      return { kind: 'eligible', file, fileHash };
    });

    const eligibleHashes = plans
      .filter((p): p is Extract<FilePlan, { kind: 'eligible' }> => p.kind === 'eligible')
      .map((p) => p.fileHash);

    const existingBatches =
      eligibleHashes.length > 0
        ? await this.prisma.importBatch.findMany({
            where: { condominiumId, fileHash: { in: eligibleHashes } },
            include: { _count: { select: { transactions: true } } },
          })
        : [];

    type BatchWithCount = (typeof existingBatches)[number];
    const dedupByHash = new Map<string, BatchWithCount>();
    for (const batch of existingBatches) {
      dedupByHash.set(batch.fileHash, batch);
    }

    const results: Record<string, unknown>[] = [];

    for (const plan of plans) {
      if (plan.kind === 'error') {
        results.push(plan.result);
        continue;
      }

      const { file, fileHash } = plan;
      this.logger.log(`upload: file=${file.originalname}, size=${file.size}B, mime=${file.mimetype}`);

      const duplicate = dedupByHash.get(fileHash);

      if (duplicate?.status === 'COMPLETED' && duplicate._count.transactions > 0) {
        this.logger.log('upload: COMPLETED duplicate found, skipping');
        results.push({
          fileName: file.originalname,
          status: 'duplicate',
          message: 'File already imported',
          existingBatchId: duplicate.id,
        });
        continue;
      }

      if (duplicate?.status === 'COMPLETED' && duplicate._count.transactions === 0) {
        this.logger.log(`upload: stale COMPLETED batch with 0 transactions, deleting id=${duplicate.id}`);
        await this.prisma.importBatch.delete({ where: { id: duplicate.id } });
        dedupByHash.delete(fileHash);
      } else if (duplicate?.status === 'PENDING') {
        this.logger.log(`upload: PENDING batch found, returning existing batchId=${duplicate.id}`);
        results.push({
          fileName: file.originalname,
          status: 'queued',
          batchId: duplicate.id,
          message: 'File already queued',
        });
        continue;
      }

      const fileType = file.mimetype.includes('pdf') ? 'pdf' : 'xlsx';

      const batch = await this.prisma.importBatch.create({
        data: {
          condominiumId,
          importedById: user.sub,
          fileName: file.originalname,
          fileType,
          fileSizeBytes: file.size,
          fileHash,
          status: 'PENDING',
        },
        include: { _count: { select: { transactions: true } } },
      });

      dedupByHash.set(fileHash, batch);

      this.logger.log(`upload: created PENDING batch id=${batch.id}, R2 configured=${this.storage.isConfigured()}`);

      const warnings: string[] = [];

      if (this.storage.isConfigured()) {
        const storageKey = `condominiums/${condominiumId}/imports/${batch.id}/${file.originalname}`;
        try {
          this.logger.log(`upload: uploading to R2, key=${storageKey}`);
          await this.storage.uploadFile(storageKey, file.buffer, file.mimetype);
          await this.prisma.importBatch.update({
            where: { id: batch.id },
            data: { storageKey, storageProvider: 'r2' },
          });
          this.logger.log(`upload: R2 upload complete, key=${storageKey}`);
        } catch (err) {
          this.logger.error(
            'upload: R2 upload failed',
            err instanceof Error ? err.stack : String(err),
          );
          warnings.push('storage.retentionFailed');
          await this.audit.log({
            condominiumId,
            userId: user.sub,
            action: 'IMPORT_FAILED',
            actionCategory: 'CREATE',
            module: 'imports',
            entityType: 'ImportBatch',
            entityId: batch.id,
            result: 'WARNING',
            description: 'storage.retentionFailed',
            afterState: {
              fileName: file.originalname,
              storageProvider: 'r2',
            },
          });
        }
      }

      results.push({
        fileName: file.originalname,
        status: 'queued',
        batchId: batch.id,
        message: 'File queued for processing',
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    return results;
  }

  async confirm(
    condominiumId: string,
    dto: ConfirmImportDto,
    user: JwtPayload,
  ) {
    const feesCheck = await this.settings.validateFeesConfigured(condominiumId);
    if (!feesCheck.valid) {
      throw new BadRequestException({
        code: 'FEES_NOT_CONFIGURED',
        reason: 'Configure condominium fees before importing transactions',
        missingFields: feesCheck.missingFields,
      });
    }

    if (!dto.files || dto.files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    const results: {
      fileName: string;
      status: 'imported' | 'duplicate' | 'skipped';
      batchId?: string;
      imported: number;
      duplicateFile: boolean;
      classification?: { total: number; classified: number; needsReview: number; unmatched: number };
      validationReport?: ValidationReport;
    }[] = [];

    let totalImported = 0;

    for (const file of dto.files) {
      try {
      if (!file.transactions || file.transactions.length === 0) {
        results.push({
          fileName: file.fileName,
          status: 'skipped',
          imported: 0,
          duplicateFile: false,
        });
        continue;
      }

      if (file.transactions.length > MAX_ROWS_PER_IMPORT) {
        throw new BadRequestException({
          code: 'ROW_LIMIT_EXCEEDED',
          reason: `File ${file.fileName} exceeds the ${MAX_ROWS_PER_IMPORT}-row import limit`,
          fileName: file.fileName,
          rowCount: file.transactions.length,
          rowLimit: MAX_ROWS_PER_IMPORT,
        });
      }

      this.logger.log(`confirm: file=${file.fileName}, transactions=${file.transactions.length}, hash=${file.fileHash.slice(0, 16)}...`);

      const existing = await this.prisma.importBatch.findFirst({
        where: { condominiumId, fileHash: file.fileHash },
        include: { _count: { select: { transactions: true } } },
      });

      if (existing?.status === 'COMPLETED' && existing._count.transactions > 0) {
        this.logger.log(`confirm: duplicate detected, batchId=${existing.id}`);
        results.push({
          fileName: file.fileName,
          status: 'duplicate',
          batchId: existing.id,
          imported: 0,
          duplicateFile: true,
        });
        continue;
      }
      // If COMPLETED with 0 transactions, fall through and treat it like a PENDING batch
      // (reuse the record in the $transaction block below).

      // CLAUDE.md §11 Stage 3 — domain validation with 30 % abort threshold.
      const { valid: validTransactions, report: validationReport } = validateRows(
        file.transactions,
      );
      if (validationReport.invalidRatio > INVALID_ROWS_THRESHOLD) {
        // GlobalExceptionFilter strips extra payload fields; encode a human-readable
        // summary into `reason` and keep the full report on the audit log entry.
        const fieldCounts: Record<string, number> = {};
        for (const e of validationReport.errors) {
          fieldCounts[e.field] = (fieldCounts[e.field] ?? 0) + 1;
        }
        const breakdown = Object.entries(fieldCounts)
          .map(([field, count]) => `${field}(${count})`)
          .join(', ');
        throw new BadRequestException({
          code: 'INVALID_ROWS_EXCEEDED',
          reason: `File ${file.fileName} has ${validationReport.invalidRows} of ${validationReport.totalRows} rows invalid (${(validationReport.invalidRatio * 100).toFixed(1)}% > ${(INVALID_ROWS_THRESHOLD * 100).toFixed(0)}%): ${breakdown}`,
          validationReport,
        });
      }

      const totalIncome = validTransactions.reduce(
        (sum, t) => sum + (t.credits ?? 0),
        0,
      );
      const totalExpenses = validTransactions.reduce(
        (sum, t) => sum + (t.charges ?? 0),
        0,
      );
      const finalBalance =
        validTransactions[validTransactions.length - 1]?.balance ?? 0;

      const batch = await this.prisma.$transaction(async (tx) => {
        let importBatch;

        if (existing) {
          // PENDING batch from upload step — update to COMPLETED, preserve storageKey.
          // Optimistic precondition: the row must still match the (updatedAt, status)
          // pair we loaded outside the transaction. If a parallel confirm modified or
          // completed it in between, updateMany returns count=0 and we abort instead
          // of double-inserting transactions.
          this.logger.log(`confirm: updating PENDING batch ${existing.id} to COMPLETED`);
          const conditional = await tx.importBatch.updateMany({
            where: {
              id: existing.id,
              updatedAt: existing.updatedAt,
              status: { not: 'COMPLETED' },
            },
            data: {
              importedById: user.sub,
              status: 'COMPLETED',
              totalRows: validTransactions.length,
              totalIncome,
              totalExpenses,
              finalBalance,
              transactionCount: validTransactions.length,
              warnings: file.warnings,
              completedAt: new Date(),
            },
          });
          if (conditional.count === 0) {
            throw new ConflictException({
              code: 'IMPORT_BATCH_RACE',
              reason: 'Import batch was modified or completed by another request',
              existingBatchId: existing.id,
            });
          }
          importBatch = await tx.importBatch.findUniqueOrThrow({
            where: { id: existing.id },
          });
        } else {
          importBatch = await tx.importBatch.create({
            data: {
              condominiumId,
              importedById: user.sub,
              fileName: file.fileName,
              fileType: file.fileType,
              fileSizeBytes: file.fileSizeBytes,
              fileHash: file.fileHash,
              status: 'COMPLETED',
              totalRows: validTransactions.length,
              totalIncome,
              totalExpenses,
              finalBalance,
              transactionCount: validTransactions.length,
              warnings: file.warnings,
              completedAt: new Date(),
            },
          });
        }

        const CHUNK = 500;
        for (let i = 0; i < validTransactions.length; i += CHUNK) {
          const chunk = validTransactions.slice(i, i + CHUNK);
          await tx.transaction.createMany({
            data: chunk.map((t) => ({
              condominiumId,
              importBatchId: importBatch.id,
              transactionDate: new Date(t.date),
              description: t.description,
              charges: t.charges > 0 ? t.charges : null,
              credits: t.credits > 0 ? t.credits : null,
              balance: t.balance,
              flowType: t.flowType === 'income' ? 'INCOME' : 'EXPENSE',
              reference: t.receipt ?? null,
              classificationStatus: 'NEEDS_REVIEW',
            })),
          });
        }

        return importBatch;
      });

      this.logger.log(`confirm: saved ${validTransactions.length} transactions (${validationReport.invalidRows} invalid skipped), batchId=${batch.id}`);

      const classificationSummary = await this.classification.classifyBatch(
        condominiumId,
        batch.id,
      );
      this.logger.log(
        `confirm: classification done ${JSON.stringify(classificationSummary)}`,
      );

      results.push({
        fileName: file.fileName,
        status: 'imported',
        batchId: batch.id,
        imported: validTransactions.length,
        duplicateFile: false,
        classification: classificationSummary,
        validationReport,
      });

      totalImported += validTransactions.length;

      await this.audit.log({
        condominiumId,
        userId: user.sub,
        action: 'IMPORT_COMPLETED',
        actionCategory: 'UPDATE',
        module: 'imports',
        entityType: 'ImportBatch',
        entityId: batch.id,
        result: validationReport.invalidRows > 0 ? 'WARNING' : 'SUCCESS',
        afterState: {
          fileName: file.fileName,
          transactionCount: validTransactions.length,
          invalidRowsSkipped: validationReport.invalidRows,
          totalIncome,
          totalExpenses,
          finalBalance,
          classification: classificationSummary,
        },
      });
      } catch (err) {
        const exceptionPayload =
          err instanceof BadRequestException || err instanceof ConflictException
            ? (err.getResponse() as Record<string, unknown>)
            : undefined;
        const errorCode =
          (exceptionPayload?.code as string | undefined) ??
          (err instanceof Error ? err.constructor.name : 'UNEXPECTED_ERROR');
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`confirm: failed for file=${file.fileName} (${errorCode}): ${message}`);
        await this.audit.log({
          condominiumId,
          userId: user.sub,
          action: 'IMPORT_FAILED',
          actionCategory: 'UPDATE',
          module: 'imports',
          entityType: 'ImportBatch',
          result: 'ERROR',
          description: message,
          afterState: {
            fileName: file.fileName,
            errorCode,
            ...(exceptionPayload?.validationReport
              ? { validationReport: exceptionPayload.validationReport }
              : {}),
          },
        });
        throw err;
      }
    }

    return {
      files: results,
      totalImported,
      totalSkipped: results.filter((r) => r.status !== 'imported').length,
      totalFiles: dto.files.length,
    };
  }

  async remove(condominiumId: string, id: string) {
    await this.findOne(condominiumId, id);

    const result = await this.prisma.importBatch.updateMany({
      where: { id, condominiumId },
      data: { status: 'FAILED', errorMessage: 'Deleted by user' },
    });
    if (result.count === 0) throw new NotFoundException('Import batch not found');
    return this.findOne(condominiumId, id);
  }
}
