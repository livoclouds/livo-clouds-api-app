import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
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

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly classification: ClassificationService,
    private readonly settings: SettingsService,
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
        }
      }

      results.push({
        fileName: file.originalname,
        status: 'queued',
        batchId: batch.id,
        message: 'File queued for processing',
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
    }[] = [];

    let totalImported = 0;

    for (const file of dto.files) {
      if (!file.transactions || file.transactions.length === 0) {
        results.push({
          fileName: file.fileName,
          status: 'skipped',
          imported: 0,
          duplicateFile: false,
        });
        continue;
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

      const totalIncome = file.transactions.reduce(
        (sum, t) => sum + (t.credits ?? 0),
        0,
      );
      const totalExpenses = file.transactions.reduce(
        (sum, t) => sum + (t.charges ?? 0),
        0,
      );
      const finalBalance =
        file.transactions[file.transactions.length - 1]?.balance ?? 0;

      const batch = await this.prisma.$transaction(async (tx) => {
        let importBatch;

        if (existing) {
          // PENDING batch from upload step — update to COMPLETED, preserve storageKey
          this.logger.log(`confirm: updating PENDING batch ${existing.id} to COMPLETED`);
          importBatch = await tx.importBatch.update({
            where: { id: existing.id },
            data: {
              importedById: user.sub,
              status: 'COMPLETED',
              totalRows: file.transactions.length,
              totalIncome,
              totalExpenses,
              finalBalance,
              transactionCount: file.transactions.length,
              warnings: file.warnings,
              completedAt: new Date(),
            },
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
              totalRows: file.transactions.length,
              totalIncome,
              totalExpenses,
              finalBalance,
              transactionCount: file.transactions.length,
              warnings: file.warnings,
              completedAt: new Date(),
            },
          });
        }

        const CHUNK = 500;
        for (let i = 0; i < file.transactions.length; i += CHUNK) {
          const chunk = file.transactions.slice(i, i + CHUNK);
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

      this.logger.log(`confirm: saved ${file.transactions.length} transactions, batchId=${batch.id}`);

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
        imported: file.transactions.length,
        duplicateFile: false,
        classification: classificationSummary,
      });

      totalImported += file.transactions.length;
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
