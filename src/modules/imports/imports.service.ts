import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClassificationService } from '../classification/classification.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { ConfirmImportDto, ParsedTransactionDto } from './dto/confirm-import.dto';
import { ListImportBatchesDto } from './dto/list-import-batches.dto';
import { ImportsParserService, buildPeriods, ImportProfileMismatchError } from './parser';
import type { ParsedRow as ServerParsedRow, PreviewFileResult, PreviewApiResponse } from './parser';
import { BankProfilesService } from '../bank-profiles/bank-profiles.service';
import {
  IMPORT_COMPLETED_EVENT,
  IMPORT_DUPLICATE_EVENT,
  IMPORT_FAILED_EVENT,
  IMPORT_WARNING_EVENT,
  type ImportCompletedEventPayload,
  type ImportDuplicateEventPayload,
  type ImportFailedEventPayload,
  type ImportWarningEventPayload,
} from './events/import-notification-events';

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

// UF-001 reconciliation — compare client preview rows to server-parsed rows.
// Server rows are the persistence source of truth; the diff is informational
// (audit trail only). Matching is positional after sorting by date+description
// to be resilient to insertion order differences across parser versions.
export interface ReconciliationSample {
  rowIndex: number;
  field: 'date' | 'description' | 'amount' | 'balance' | 'rowCount';
  client: string | number;
  server: string | number;
}

export interface ReconciliationReport {
  clientRowCount: number;
  serverRowCount: number;
  mismatchCount: number;
  sampleMismatches: ReconciliationSample[];
}

function normalizeForCompare(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function reconcileRows(
  clientRows: ParsedTransactionDto[],
  serverRows: ServerParsedRow[],
): ReconciliationReport {
  const sampleMismatches: ReconciliationSample[] = [];
  let mismatchCount = 0;

  const len = Math.max(clientRows.length, serverRows.length);
  for (let i = 0; i < len; i++) {
    const c = clientRows[i];
    const s = serverRows[i];
    if (!c || !s) {
      mismatchCount++;
      if (sampleMismatches.length < 5) {
        sampleMismatches.push({
          rowIndex: i,
          field: 'description',
          client: c ? `${c.description}` : '<missing>',
          server: s ? `${s.description}` : '<missing>',
        });
      }
      continue;
    }
    let rowMismatch = false;
    if (c.date !== s.date) {
      rowMismatch = true;
      if (sampleMismatches.length < 5) {
        sampleMismatches.push({ rowIndex: i, field: 'date', client: c.date, server: s.date });
      }
    }
    if (normalizeForCompare(c.description) !== normalizeForCompare(s.description)) {
      rowMismatch = true;
      if (sampleMismatches.length < 5) {
        sampleMismatches.push({
          rowIndex: i,
          field: 'description',
          client: c.description,
          server: s.description,
        });
      }
    }
    const clientAmount = (c.credits ?? 0) - (c.charges ?? 0);
    const serverAmount = (s.credits ?? 0) - (s.charges ?? 0);
    if (Math.abs(clientAmount - serverAmount) > 0.005) {
      rowMismatch = true;
      if (sampleMismatches.length < 5) {
        sampleMismatches.push({
          rowIndex: i,
          field: 'amount',
          client: clientAmount,
          server: serverAmount,
        });
      }
    }
    // Phase 2 IMP-001 — balance is an explicit tamper vector per the audit
    // acceptance criteria. Same currency tolerance as amount.
    if (Math.abs((c.balance ?? 0) - (s.balance ?? 0)) > 0.005) {
      rowMismatch = true;
      if (sampleMismatches.length < 5) {
        sampleMismatches.push({
          rowIndex: i,
          field: 'balance',
          client: c.balance ?? 0,
          server: s.balance ?? 0,
        });
      }
    }
    if (rowMismatch) mismatchCount++;
  }

  if (clientRows.length !== serverRows.length && sampleMismatches.length < 5) {
    sampleMismatches.push({
      rowIndex: -1,
      field: 'rowCount',
      client: clientRows.length,
      server: serverRows.length,
    });
  }

  return {
    clientRowCount: clientRows.length,
    serverRowCount: serverRows.length,
    mismatchCount,
    sampleMismatches,
  };
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  private sanitizeFileName(name: string): string {
    return (
      name
        .replace(/[/\\]/g, '_')           // path separators → underscore
        .replace(/\x00/g, '')             // null bytes removed
        .replace(/^\.+/, '')              // leading dots stripped
        .replace(/[^\w\s.\-()\[\]]/g, '_') // other unsafe chars → underscore
        .trim() || 'unnamed'              // guarantee non-empty
    );
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly classification: ClassificationService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly parser: ImportsParserService,
    private readonly config: ConfigService,
    private readonly bankProfiles: BankProfilesService,
    private readonly events: EventEmitter2,
  ) {}

  async findAll(condominiumId: string, dto: ListImportBatchesDto) {
    const {
      page = 1, limit = 15, fileName, fileType, importedByName, status, dateFrom, dateTo,
      transactionCountMin, transactionCountMax,
      incomeMin, incomeMax,
      expensesMin, expensesMax,
    } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.ImportBatchWhereInput = { condominiumId };
    if (fileName) where.fileName = { contains: fileName, mode: 'insensitive' };
    if (fileType) where.fileType = fileType;
    if (importedByName) {
      const nameParts = importedByName.trim().split(/\s+/);
      where.importedBy = {
        OR: [
          { firstName: { contains: importedByName, mode: 'insensitive' } },
          { lastName: { contains: importedByName, mode: 'insensitive' } },
          // Handle "First Last" full-name searches: match first token against
          // firstName and remaining tokens against lastName
          ...(nameParts.length > 1
            ? [
                {
                  AND: [
                    {
                      firstName: {
                        contains: nameParts[0],
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      lastName: {
                        contains: nameParts.slice(1).join(' '),
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      };
    }
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (transactionCountMin !== undefined || transactionCountMax !== undefined) {
      where.transactionCount = {
        ...(transactionCountMin !== undefined && { gte: transactionCountMin }),
        ...(transactionCountMax !== undefined && { lte: transactionCountMax }),
      };
    }
    if (incomeMin !== undefined || incomeMax !== undefined) {
      where.totalIncome = {
        ...(incomeMin !== undefined && { gte: incomeMin }),
        ...(incomeMax !== undefined && { lte: incomeMax }),
      };
    }
    if (expensesMin !== undefined || expensesMax !== undefined) {
      where.totalExpenses = {
        ...(expensesMin !== undefined && { gte: expensesMin }),
        ...(expensesMax !== undefined && { lte: expensesMax }),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.importBatch.findMany({
        where,
        include: {
          importedBy: { select: { id: true, firstName: true, lastName: true } },
          fileDeletedBy: { select: { id: true, firstName: true, lastName: true } },
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
        fileDeletedBy: { select: { id: true, firstName: true, lastName: true } },
        transactions: { take: 50, orderBy: { transactionDate: 'desc' } },
      },
    });

    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    return batch;
  }

  /**
   * Issue a short-lived presigned URL to download the original imported file.
   *
   * The file lives in R2 and is independent from the batch's DB record: a ROOT
   * may delete it via the storage-admin module, which stamps `fileDeletedAt`.
   * We surface a typed FILE_NOT_AVAILABLE error in that case (and when no file
   * was ever retained) so the web can disable/explain the download affordance.
   */
  async getDownloadUrl(condominiumId: string, id: string, user: JwtPayload) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, condominiumId },
      select: {
        fileName: true,
        fileSizeBytes: true,
        storageKey: true,
        storageProvider: true,
        fileDeletedAt: true,
      },
    });

    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    if (!batch.storageKey || batch.storageProvider !== 'r2' || batch.fileDeletedAt) {
      throw new BadRequestException({
        code: 'FILE_NOT_AVAILABLE',
        reason: batch.fileDeletedAt
          ? 'The original file has been deleted from storage'
          : 'No retained file in storage for this import',
      });
    }

    const url = await this.storage.getPresignedUrl(batch.storageKey, 3600, {
      userId: user.sub,
      condominiumId,
      byteSize: batch.fileSizeBytes,
    });

    return { url, fileName: batch.fileName, expiresIn: 3600 };
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
          code: 'DUPLICATE_FILE',
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
      const strictR2 = this.config.get<boolean>('storage.strictR2Retention') ?? true;

      if (this.storage.isConfigured()) {
        const storageKey = `condominiums/${condominiumId}/imports/${batch.id}/${this.sanitizeFileName(file.originalname)}`;
        let r2Failed = false;
        try {
          this.logger.log(`upload: uploading to R2, key=${storageKey}`);
          await this.storage.uploadFile(storageKey, file.buffer, file.mimetype);
          await this.prisma.importBatch.update({
            where: { id: batch.id },
            data: { storageKey, storageProvider: 'r2' },
          });
          this.logger.log(`upload: R2 upload complete, key=${storageKey}`);
        } catch (err) {
          r2Failed = true;
          this.logger.error(
            'upload: R2 upload failed',
            err instanceof Error ? err.stack : String(err),
          );
          await this.audit.log({
            condominiumId,
            userId: user.sub,
            action: 'IMPORT_FAILED',
            actionCategory: 'CREATE',
            module: 'imports',
            entityType: 'ImportBatch',
            entityId: batch.id,
            result: 'ERROR',
            description: err instanceof Error ? err.message : 'storage.retentionFailed',
            afterState: {
              fileName: file.originalname,
              storageProvider: 'r2',
              errorCode: 'STORAGE_UNAVAILABLE',
              strictR2,
            },
          });
        }

        if (r2Failed) {
          if (strictR2) {
            // UF-016 strict mode — roll back the orphan ImportBatch so confirm()
            // can never persist transactions for a file that has no retained copy.
            this.logger.warn(`upload: strict mode — deleting orphan batch ${batch.id}`);
            try {
              await this.prisma.importBatch.delete({ where: { id: batch.id } });
            } catch (delErr) {
              this.logger.error(
                'upload: failed to delete orphan batch',
                delErr instanceof Error ? delErr.stack : String(delErr),
              );
            }
            dedupByHash.delete(fileHash);
            results.push({
              fileName: file.originalname,
              status: 'error',
              message: 'Storage is currently unavailable. Please try again later.',
              errorCode: 'STORAGE_UNAVAILABLE',
            });
            continue;
          }
          warnings.push('storage.retentionFailed');
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

    // UF-017 — when every file in the request is a duplicate, escalate to
    // HTTP 409 Conflict so generic HTTP clients can distinguish a no-op from
    // a successful upload. Mixed requests stay 200 with per-file status.
    if (
      results.length > 0 &&
      results.every((r) => r.status === 'duplicate')
    ) {
      throw new ConflictException({
        code: 'DUPLICATE_FILE',
        reason: 'All files in this request were previously imported',
        files: results,
        totalFiles: results.length,
        duplicateCount: results.length,
      });
    }

    return results;
  }

  async checkHashesForCondominium(
    condominiumId: string,
    hashes: string[],
  ): Promise<{
    duplicateHashes: string[];
    duplicateFiles: { hash: string; fileName: string }[];
  }> {
    if (hashes.length === 0) {
      return { duplicateHashes: [], duplicateFiles: [] };
    }
    const existing = await this.prisma.importBatch.findMany({
      where: {
        condominiumId,
        fileHash: { in: hashes },
        status: 'COMPLETED',
      },
      select: {
        fileHash: true,
        fileName: true,
        _count: { select: { transactions: true } },
      },
    });
    const seen = new Map<string, string>();
    for (const b of existing) {
      if (b._count.transactions > 0) seen.set(b.fileHash, b.fileName);
    }
    return {
      duplicateHashes: Array.from(seen.keys()),
      duplicateFiles: Array.from(seen.entries()).map(([hash, fileName]) => ({
        hash,
        fileName,
      })),
    };
  }

  async preview(
    condominiumId: string,
    files: { buffer: Buffer; originalname: string; mimetype: string; size: number }[],
    storedHashes: string[],
    clientIds: string[],
    bankProfileId?: string,
  ): Promise<PreviewApiResponse> {
    const results: PreviewFileResult[] = [];

    // Defence-in-depth dedup: hash each uploaded file once up-front and look up
    // all matching COMPLETED batches in this condominium in a single query, so
    // we catch duplicates that the client's localStorage cache missed (different
    // browser, cleared cache, second device). The web also pre-checks with
    // POST /imports/check-hashes before uploading; this server-side check
    // guarantees the parser is skipped even if that pre-check is bypassed.
    const fileHashes: string[] = files.map((f) =>
      crypto.createHash('sha256').update(f.buffer).digest('hex'),
    );
    const dbDuplicateHashes = new Set<string>();
    if (fileHashes.length > 0) {
      const existing = await this.prisma.importBatch.findMany({
        where: {
          condominiumId,
          fileHash: { in: fileHashes },
          status: 'COMPLETED',
        },
        select: { fileHash: true, _count: { select: { transactions: true } } },
      });
      for (const b of existing) {
        if (b._count.transactions > 0) dbDuplicateHashes.add(b.fileHash);
      }
    }

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const id = clientIds[index] ?? crypto.randomUUID();
      const base: PreviewFileResult = {
        id,
        fileName: file.originalname,
        fileType: 'xlsx',
        fileSizeBytes: file.size,
        fileHash: '',
        status: 'error',
        periods: [],
        transactionCount: 0,
        totalIncome: 0,
        totalExpenses: 0,
        finalBalance: 0,
        transactions: [],
        warnings: [],
        processedAt: new Date().toISOString(),
      };

      if (file.size > MAX_FILE_SIZE_BYTES) {
        results.push({
          ...base,
          statusMessage: `File exceeds 20 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
        });
        continue;
      }

      const hash = fileHashes[index];

      if (storedHashes.includes(hash) || dbDuplicateHashes.has(hash)) {
        const ext = file.originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xlsx';
        results.push({
          ...base,
          fileType: ext,
          fileHash: hash,
          status: 'duplicate',
          statusMessage: 'This file has already been imported previously.',
        });
        continue;
      }

      const isXlsx = isXlsxMagicBytes(file.buffer);
      const isPdf = isPdfMagicBytes(file.buffer);

      if (!isXlsx && !isPdf) {
        results.push({
          ...base,
          fileHash: hash,
          statusMessage: 'File content does not match a valid PDF or Excel format.',
        });
        continue;
      }

      const fileType: 'xlsx' | 'pdf' = isXlsx ? 'xlsx' : 'pdf';

      let profileContext: Awaited<ReturnType<typeof this.bankProfiles.resolveFieldsForBatch>> | undefined;

      try {
        profileContext = await this.bankProfiles.resolveFieldsForBatch({
          condominiumId,
          bankProfileId,
          fileType,
        });

        const { transactions, warnings } = await this.parser.parseBuffer(
          file.buffer,
          fileType,
          profileContext.fields,
        );

        if (transactions.length > MAX_ROWS_PER_IMPORT) {
          results.push({
            ...base,
            fileType,
            fileHash: hash,
            statusMessage: `File exceeds the ${MAX_ROWS_PER_IMPORT.toLocaleString()}-row import limit (${transactions.length.toLocaleString()} rows).`,
          });
          continue;
        }

        const totalIncome = transactions.reduce((sum, tx) => sum + tx.credits, 0);
        const totalExpenses = transactions.reduce((sum, tx) => sum + tx.charges, 0);
        const sorted = [...transactions].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
        const finalBalance = sorted[0]?.balance ?? 0;
        const periods = buildPeriods(transactions);

        const status =
          transactions.length === 0 ? 'error' : warnings.length > 0 ? 'warning' : 'success';

        results.push({
          id,
          fileName: file.originalname,
          fileType,
          fileSizeBytes: file.size,
          fileHash: hash,
          status,
          statusMessage:
            transactions.length === 0
              ? 'No transactions could be extracted from this file.'
              : undefined,
          periods,
          transactionCount: transactions.length,
          totalIncome,
          totalExpenses,
          finalBalance,
          transactions,
          warnings,
          processedAt: new Date().toISOString(),
        });
      } catch (err) {
        if (err instanceof ImportProfileMismatchError) {
          throw new BadRequestException({
            code: 'PROFILE_MISMATCH',
            reason:
              'The selected bank profile does not match the columns found in this file. Update the profile or pick a different one.',
            fileName: file.originalname,
            missingFields: err.missingFields,
            actualHeaders: err.actualHeaders,
            bankProfileId: bankProfileId ?? null,
            profileName: profileContext?.profileName ?? null,
          });
        }
        results.push({
          ...base,
          fileType,
          fileHash: hash,
          statusMessage:
            err instanceof Error
              ? err.message
              : 'An unexpected error occurred while parsing the file.',
        });
      }
    }

    return { results };
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

    // Bank-profile guard: selecting a profile is optional, but when one IS
    // selected it must have a bank assigned — the classification engine keys
    // bank-specific parsing off it (e.g. BanBajío unit extraction). The web
    // blocks the upload earlier; this is defense in depth.
    if (dto.bankProfileId) {
      const profile = await this.prisma.bankProfile.findFirst({
        where: { id: dto.bankProfileId, condominiumId, isActive: true },
        select: { id: true, bankName: true },
      });
      if (!profile) {
        throw new BadRequestException({
          code: 'BANK_PROFILE_NOT_FOUND',
          reason: 'The selected bank profile does not exist or is inactive.',
        });
      }
      if (!profile.bankName || profile.bankName.trim().length === 0) {
        throw new BadRequestException({
          code: 'BANK_PROFILE_MISSING_BANK',
          reason: 'Assign a bank to the selected profile before importing.',
        });
      }
    }

    if (!dto.files || dto.files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    const results: {
      fileName: string;
      status: 'imported' | 'duplicate' | 'skipped' | 'processing';
      batchId?: string;
      imported: number;
      duplicateFile: boolean;
      code?: 'DUPLICATE_FILE';
      classification?: { total: number; classified: number; needsReview: number; unmatched: number };
      validationReport?: ValidationReport;
      reconciliation?: ReconciliationReport;
    }[] = [];

    let totalImported = 0;
    // UF-007 — batches whose persistence completed but whose classification is
    // still running. The web client polls each one via GET /imports/:id until
    // the batch reaches COMPLETED or FAILED.
    const pendingBatchIds: string[] = [];

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

      this.logger.log(
        `confirm: file=${file.fileName}, batchId=${file.batchId ?? 'none'}, transactions=${file.transactions.length}, hash=${file.fileHash.slice(0, 16)}...`,
      );

      // Phase 3: prefer explicit batchId lookup when the client provides one.
      // Preserves fileHash fallback for backward compatibility.
      type BatchWithCount = Prisma.ImportBatchGetPayload<{
        include: { _count: { select: { transactions: true } } };
      }>;
      let existing: BatchWithCount | null = null;

      if (file.batchId) {
        // Unscoped lookup first — required to distinguish 403 (cross-tenant) from 404 (missing).
        const byId = await this.prisma.importBatch.findUnique({
          where: { id: file.batchId },
          include: { _count: { select: { transactions: true } } },
        });
        if (!byId) {
          throw new NotFoundException({
            code: 'BATCH_NOT_FOUND',
            reason: 'No import batch found for the provided batchId. Upload the file before confirming.',
            fileName: file.fileName,
          });
        }
        if (byId.condominiumId !== condominiumId) {
          throw new ForbiddenException({
            code: 'BATCH_CROSS_TENANT',
            reason: 'The provided batchId does not belong to this condominium.',
            fileName: file.fileName,
          });
        }
        existing = byId;
      } else {
        // When confirm arrives without an explicit batchId, fall back to the
        // most RECENT batch for this fileHash. Ordering is required: an older
        // PENDING/FAILED batch (e.g. an interrupted earlier attempt) may have no
        // storageKey, and an unordered findFirst could return it instead of the
        // freshly retained one — producing a spurious IMPORT_BATCH_NO_STORAGE.
        existing = await this.prisma.importBatch.findFirst({
          where: { condominiumId, fileHash: file.fileHash },
          include: { _count: { select: { transactions: true } } },
          orderBy: { createdAt: 'desc' },
        });
      }

      // UF-007 — PROCESSING is now a steady-state for async classification.
      // A re-confirm during the brief async window must not re-enter the
      // $transaction (the updatedAt precondition catches it but only after the
      // re-parse work is wasted). Treat PROCESSING + transactions as duplicate.
      // COMPLETED + transactions is the original duplicate case.
      // FAILED is not treated as duplicate so the existing user-delete-then-
      // reupload recovery path is preserved.
      if (
        existing &&
        (existing.status === 'COMPLETED' || existing.status === 'PROCESSING') &&
        existing._count.transactions > 0
      ) {
        this.logger.log(
          `confirm: duplicate detected, batchId=${existing.id} status=${existing.status}`,
        );
        results.push({
          fileName: file.fileName,
          status: 'duplicate',
          code: 'DUPLICATE_FILE',
          batchId: existing.id,
          imported: 0,
          duplicateFile: true,
        });
        this.events.emit(IMPORT_DUPLICATE_EVENT, {
          condominiumId,
          originalBatchId: existing.id,
          attemptedFileName: file.fileName,
          actorUserId: user.sub,
        } satisfies ImportDuplicateEventPayload);
        continue;
      }
      // If COMPLETED with 0 transactions, fall through and treat it like a PENDING batch
      // (reuse the record in the $transaction block below).

      // UF-001 / UF-015 trust-boundary enforcement —
      // the server re-derives transactions from the R2 file and uses *its own* parsed
      // rows as the persistence source of truth. Client-supplied `file.transactions`
      // is reduced to a preview/reconciliation signal that never crosses the
      // persistence boundary.
      if (!existing) {
        throw new ConflictException({
          code: 'IMPORT_BATCH_NOT_FOUND',
          reason: 'No matching import batch for this fileHash. Upload the file before confirming.',
          fileName: file.fileName,
        });
      }
      if (!existing.storageKey || existing.storageProvider !== 'r2') {
        throw new ConflictException({
          code: 'IMPORT_BATCH_NO_STORAGE',
          reason: 'Cannot confirm: no retained file in storage for this batch',
          existingBatchId: existing.id,
        });
      }

      this.logger.log(`confirm: re-downloading file from R2 key=${existing.storageKey}`);
      const r2Buffer = await this.storage.downloadFile(existing.storageKey);

      // UF-015 — re-verify the R2 object content matches the hash the API
      // recorded at upload time. The client-supplied fileHash is never trusted
      // as an authorization decision; the API's stored hash is the integrity anchor.
      const canonicalHash = crypto
        .createHash('sha256')
        .update(r2Buffer)
        .digest('hex');
      if (canonicalHash !== existing.fileHash) {
        this.logger.error(
          `confirm: R2 content hash mismatch for batch ${existing.id} (stored=${existing.fileHash.slice(0, 16)}, r2=${canonicalHash.slice(0, 16)})`,
        );
        throw new ConflictException({
          code: 'IMPORT_HASH_MISMATCH',
          reason: 'The retained file content does not match the recorded hash. Re-upload required.',
          existingBatchId: existing.id,
        });
      }

      // UF-001 — server-side canonical re-parse. These rows replace the
      // client-supplied array for all persistence-side computations.
      const { transactions: serverParsedRaw, warnings: parserWarnings } =
        await this.parser.parseBuffer(r2Buffer, existing.fileType);
      this.logger.log(
        `confirm: server re-parse produced ${serverParsedRaw.length} rows (client sent ${file.transactions.length})`,
      );

      // CLAUDE.md §11 Stage 3 — domain validation runs over server rows now.
      const { valid: validTransactions, report: validationReport } = validateRows(
        serverParsedRaw,
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
        this.events.emit(IMPORT_FAILED_EVENT, {
          condominiumId,
          batchId: existing.id,
          stage: 'VALIDATE',
          errorCode: 'INVALID_ROWS_EXCEEDED',
          actorUserId: user.sub,
        } satisfies ImportFailedEventPayload);
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

      // Phase 2 IMP-001 — strict trust-boundary enforcement. Reconciliation
      // compares the client preview rows against the server re-parsed rows
      // (the persistence source of truth). Any structural mismatch — modified
      // credit/debit/date/description/balance, or row-count delta — is treated
      // as tampering and the confirm is rejected with PAYLOAD_MISMATCH. The
      // IMPORT_TAMPERING_DETECTED audit row is written first so the forensic
      // trace survives the rejection.
      const reconciliation = reconcileRows(file.transactions, serverParsedRaw);
      const rowCountMismatch =
        reconciliation.clientRowCount !== reconciliation.serverRowCount;
      if (reconciliation.mismatchCount > 0 || rowCountMismatch) {
        this.logger.warn(
          `confirm: client/server reconciliation mismatch for ${file.fileName} — ${reconciliation.mismatchCount} rows differ (client=${reconciliation.clientRowCount}, server=${reconciliation.serverRowCount})`,
        );
        await this.audit.log({
          condominiumId,
          userId: user.sub,
          action: 'IMPORT_TAMPERING_DETECTED',
          actionCategory: 'READ',
          module: 'imports',
          entityType: 'ImportBatch',
          entityId: existing.id,
          result: 'WARNING',
          description: `Client/server payload reconciliation mismatch (${reconciliation.mismatchCount} rows)`,
          afterState: {
            fileName: file.fileName,
            clientRowCount: reconciliation.clientRowCount,
            serverRowCount: reconciliation.serverRowCount,
            mismatchCount: reconciliation.mismatchCount,
            sampleMismatches: reconciliation.sampleMismatches,
          },
        });
        throw new BadRequestException({
          code: 'PAYLOAD_MISMATCH',
          reason:
            'Confirm payload does not match the file on the server. The preview was altered or the file changed between upload and confirm. Re-upload the file and retry.',
          fileName: file.fileName,
          existingBatchId: existing.id,
          clientRowCount: reconciliation.clientRowCount,
          serverRowCount: reconciliation.serverRowCount,
          mismatchCount: reconciliation.mismatchCount,
          sampleMismatches: reconciliation.sampleMismatches,
        });
      }

      // Persisted warnings combine the client-side parser warnings (forwarded
      // for backward compat) with any server-side parser warnings, since the
      // server-parsed rows are what is actually being stored.
      const mergedWarnings = [...(file.warnings ?? []), ...parserWarnings];

      // PENDING batch from upload step — update to COMPLETED, preserve storageKey.
      // Optimistic precondition: the row must still match the (updatedAt, status)
      // pair we loaded outside the transaction. If a parallel confirm modified or
      // completed it in between, updateMany returns count=0 and we abort instead
      // of double-inserting transactions.
      const batch = await this.prisma.$transaction(async (tx) => {
        // UF-007 — set status to PROCESSING (transactions persisted but
        // classification still pending). The async runClassificationAsync
        // method below transitions to COMPLETED (or FAILED) and writes the
        // terminal audit event. The PENDING → PROCESSING → COMPLETED chain
        // is captured by the ImportStatus enum in prisma/schema.prisma.
        this.logger.log(`confirm: updating PENDING batch ${existing.id} to PROCESSING`);
        const conditional = await tx.importBatch.updateMany({
          where: {
            id: existing.id,
            updatedAt: existing.updatedAt,
            status: { not: 'COMPLETED' },
          },
          data: {
            importedById: user.sub,
            status: 'PROCESSING',
            totalRows: validTransactions.length,
            totalIncome,
            totalExpenses,
            finalBalance,
            transactionCount: validTransactions.length,
            warnings: mergedWarnings,
            // Persist the chosen bank profile so classifyBatch can read the bank
            // identity (it was dropped before — only used for column mapping).
            bankProfileId: dto.bankProfileId ?? null,
          },
        });
        if (conditional.count === 0) {
          throw new ConflictException({
            code: 'IMPORT_BATCH_RACE',
            reason: 'Import batch was modified or completed by another request',
            existingBatchId: existing.id,
          });
        }
        const importBatch = await tx.importBatch.findUniqueOrThrow({
          where: { id: existing.id },
        });

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

      // UF-007 — capture the per-file result with status:'processing'. The
      // batch row is now PROCESSING; classification runs out-of-band and the
      // web polls GET /imports/:id until status reaches COMPLETED/FAILED.
      results.push({
        fileName: file.fileName,
        status: 'processing',
        batchId: batch.id,
        imported: validTransactions.length,
        duplicateFile: false,
        validationReport,
        reconciliation,
      });

      totalImported += validTransactions.length;
      pendingBatchIds.push(batch.id);

      const auditResult =
        validationReport.invalidRows > 0 || reconciliation.mismatchCount > 0
          ? 'WARNING'
          : 'SUCCESS';
      await this.audit.log({
        condominiumId,
        userId: user.sub,
        action: 'IMPORT_PROCESSING',
        actionCategory: 'UPDATE',
        module: 'imports',
        entityType: 'ImportBatch',
        entityId: batch.id,
        result: auditResult,
        afterState: {
          fileName: file.fileName,
          transactionCount: validTransactions.length,
          invalidRowsSkipped: validationReport.invalidRows,
          totalIncome,
          totalExpenses,
          finalBalance,
          reconciliation: {
            clientRowCount: reconciliation.clientRowCount,
            serverRowCount: reconciliation.serverRowCount,
            mismatchCount: reconciliation.mismatchCount,
          },
        },
      });

      // UF-007 — defer classification via setImmediate so the HTTP response
      // returns before classification runs. CLAUDE.md prohibits queue
      // infrastructure; this is a single-process deferral. The async method
      // owns the PROCESSING → COMPLETED/FAILED transition and writes the
      // terminal IMPORT_COMPLETED or IMPORT_FAILED audit row.
      setImmediate(() => {
        void this.runClassificationAsync(
          condominiumId,
          batch.id,
          file.fileName,
          user.sub,
          {
            transactionCount: validTransactions.length,
            invalidRowsSkipped: validationReport.invalidRows,
            // Skipped rows plus parser warnings together describe an import
            // that succeeded but is not fully clean — it drives the
            // IMPORT_COMPLETED vs IMPORT_WITH_WARNINGS branch below.
            warningCount: validationReport.invalidRows + mergedWarnings.length,
            totalIncome,
            totalExpenses,
            finalBalance,
            reconciliationSummary: {
              clientRowCount: reconciliation.clientRowCount,
              serverRowCount: reconciliation.serverRowCount,
              mismatchCount: reconciliation.mismatchCount,
            },
          },
        );
      });
      } catch (err) {
        const exceptionPayload =
          err instanceof BadRequestException ||
          err instanceof ConflictException ||
          err instanceof ForbiddenException ||
          err instanceof NotFoundException
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

    // UF-017 — when every file in the request was already imported, escalate
    // to HTTP 409 Conflict. Mixed requests stay 200 with per-file status so
    // partial-success semantics are preserved.
    if (
      results.length === dto.files.length &&
      results.length > 0 &&
      results.every((r) => r.duplicateFile)
    ) {
      throw new ConflictException({
        code: 'DUPLICATE_FILE',
        reason: 'All files in this request were previously imported',
        files: results,
        totalFiles: dto.files.length,
        duplicateCount: results.length,
      });
    }

    return {
      files: results,
      totalImported,
      // 'processing' files are persisted (their transactions are committed);
      // they are not skipped. Only true skip cases (duplicates, empty files)
      // count here.
      totalSkipped: results.filter(
        (r) => r.status === 'duplicate' || r.status === 'skipped',
      ).length,
      totalFiles: dto.files.length,
      pendingBatchIds,
    };
  }

  // UF-007 — out-of-band classification runner. Owns the PROCESSING →
  // COMPLETED/FAILED batch transition and the terminal audit event. Never
  // throws to its setImmediate caller: any error is captured, the batch is
  // marked FAILED with errorMessage, and an IMPORT_FAILED audit is written
  // with result:'WARNING' (the transactions are still persisted).
  private async runClassificationAsync(
    condominiumId: string,
    batchId: string,
    fileName: string,
    userId: string,
    persistence: {
      transactionCount: number;
      invalidRowsSkipped: number;
      warningCount: number;
      totalIncome: number;
      totalExpenses: number;
      finalBalance: number;
      reconciliationSummary: {
        clientRowCount: number;
        serverRowCount: number;
        mismatchCount: number;
      };
    },
  ): Promise<void> {
    try {
      const classificationSummary = await this.classification.classifyBatch(
        condominiumId,
        batchId,
        userId,
      );
      this.logger.log(
        `classify-async: done batchId=${batchId} ${JSON.stringify(classificationSummary)}`,
      );

      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      const auditResult =
        persistence.invalidRowsSkipped > 0 ||
        persistence.reconciliationSummary.mismatchCount > 0
          ? 'WARNING'
          : 'SUCCESS';
      await this.audit.log({
        condominiumId,
        userId,
        action: 'IMPORT_COMPLETED',
        actionCategory: 'UPDATE',
        module: 'imports',
        entityType: 'ImportBatch',
        entityId: batchId,
        result: auditResult,
        afterState: {
          fileName,
          transactionCount: persistence.transactionCount,
          invalidRowsSkipped: persistence.invalidRowsSkipped,
          totalIncome: persistence.totalIncome,
          totalExpenses: persistence.totalExpenses,
          finalBalance: persistence.finalBalance,
          classification: classificationSummary,
          reconciliation: persistence.reconciliationSummary,
        },
      });

      // Notification fan-out is best-effort: a failure here must never roll
      // the COMPLETED batch back to FAILED, so it is isolated from the outer
      // catch. A clean import emits IMPORT_COMPLETED; an import that skipped
      // rows or raised parser warnings emits IMPORT_WITH_WARNINGS instead —
      // the two outcomes are mutually exclusive (no double-notify).
      try {
        if (persistence.warningCount > 0) {
          this.events.emit(IMPORT_WARNING_EVENT, {
            condominiumId,
            batchId,
            warningCount: persistence.warningCount,
            actorUserId: userId,
          } satisfies ImportWarningEventPayload);
        } else {
          const cs = await this.prisma.condominiumSettings.findUnique({
            where: { condominiumId },
            select: { currency: true },
          });
          // `confirm` already passed `validateFeesConfigured`, so a settings
          // row exists; `currency` is non-null (`@default("MXN")`). The `??`
          // only satisfies the type for the unreachable no-row branch.
          this.events.emit(IMPORT_COMPLETED_EVENT, {
            condominiumId,
            batchId,
            rowCount: persistence.transactionCount,
            currency: cs?.currency ?? 'MXN',
            actorUserId: userId,
          } satisfies ImportCompletedEventPayload);
        }
      } catch (emitErr) {
        this.logger.warn(
          `classify-async: notification emit failed batchId=${batchId}: ${String(emitErr)}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `classify-async: failed batchId=${batchId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      try {
        await this.prisma.importBatch.update({
          where: { id: batchId },
          data: {
            status: 'FAILED',
            errorMessage: `Classification failed: ${message}`,
          },
        });
      } catch (updateErr) {
        this.logger.error(
          `classify-async: failed to mark batch as FAILED batchId=${batchId}`,
          updateErr instanceof Error ? updateErr.stack : String(updateErr),
        );
      }
      try {
        // Transactions are persisted — classification did not run. WARNING
        // (not ERROR) because the import itself succeeded; only enrichment
        // failed. Operators can re-run classification via the existing
        // POST /imports/:batchId/classify endpoint.
        await this.audit.log({
          condominiumId,
          userId,
          action: 'IMPORT_FAILED',
          actionCategory: 'UPDATE',
          module: 'imports',
          entityType: 'ImportBatch',
          entityId: batchId,
          result: 'WARNING',
          description: `Classification failed (transactions persisted): ${message}`,
          afterState: {
            fileName,
            transactionCount: persistence.transactionCount,
            errorCode: 'CLASSIFICATION_FAILED',
          },
        });
      } catch (auditErr) {
        this.logger.error(
          'classify-async: failed to write IMPORT_FAILED audit',
          auditErr instanceof Error ? auditErr.stack : String(auditErr),
        );
      }
      try {
        this.events.emit(IMPORT_FAILED_EVENT, {
          condominiumId,
          batchId,
          stage: 'CLASSIFY',
          errorCode: 'CLASSIFICATION_FAILED',
          actorUserId: userId,
        } satisfies ImportFailedEventPayload);
      } catch (emitErr) {
        this.logger.warn(
          `classify-async: notification emit failed batchId=${batchId}: ${String(emitErr)}`,
        );
      }
    }
  }

  async remove(condominiumId: string, id: string, user: JwtPayload) {
    const existing = await this.findOne(condominiumId, id);

    const result = await this.prisma.importBatch.updateMany({
      where: { id, condominiumId },
      data: { status: 'FAILED', errorMessage: 'Deleted by user' },
    });
    if (result.count === 0) throw new NotFoundException('Import batch not found');

    await this.audit.log({
      condominiumId,
      userId: user.sub,
      action: 'IMPORT_DELETED',
      actionCategory: 'DELETE',
      module: 'imports',
      entityType: 'ImportBatch',
      entityId: id,
      result: 'SUCCESS',
      beforeState: {
        fileName: existing.fileName,
        status: existing.status,
        transactionCount: existing.transactionCount,
      },
      afterState: {
        status: 'FAILED',
        errorMessage: 'Deleted by user',
      },
    });

    return this.findOne(condominiumId, id);
  }
}
