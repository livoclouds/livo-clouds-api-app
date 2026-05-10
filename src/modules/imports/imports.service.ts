import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';

const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findAll(condominiumId: string) {
    return this.prisma.importBatch.findMany({
      where: { condominiumId },
      include: {
        importedBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { transactions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
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

    const results = [];

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        results.push({
          fileName: file.originalname,
          status: 'error',
          message: 'Invalid file type. Only PDF and XLSX are allowed.',
        });
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        results.push({
          fileName: file.originalname,
          status: 'error',
          message: 'File exceeds 20MB limit',
        });
        continue;
      }

      const fileHash = crypto
        .createHash('sha256')
        .update(file.buffer)
        .digest('hex');

      const duplicate = await this.prisma.importBatch.findFirst({
        where: { condominiumId, fileHash },
      });

      if (duplicate) {
        results.push({
          fileName: file.originalname,
          status: 'duplicate',
          message: 'File already imported',
          existingBatchId: duplicate.id,
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
      });

      if (this.storage.isConfigured()) {
        const storageKey = `condominiums/${condominiumId}/imports/${batch.id}/${file.originalname}`;
        try {
          await this.storage.uploadFile(storageKey, file.buffer, file.mimetype);
          await this.prisma.importBatch.update({
            where: { id: batch.id },
            data: { storageKey, storageProvider: 'r2' },
          });
        } catch {
          // Storage upload is non-critical — batch is already created
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
    if (!dto.files || dto.files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    const results: {
      fileName: string;
      status: 'imported' | 'duplicate' | 'skipped';
      batchId?: string;
      imported: number;
      duplicateFile: boolean;
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

      const existing = await this.prisma.importBatch.findFirst({
        where: { condominiumId, fileHash: file.fileHash },
      });

      if (existing) {
        results.push({
          fileName: file.fileName,
          status: 'duplicate',
          batchId: existing.id,
          imported: 0,
          duplicateFile: true,
        });
        continue;
      }

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
        const importBatch = await tx.importBatch.create({
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
              classificationStatus: 'AUTO',
            })),
          });
        }

        return importBatch;
      });

      results.push({
        fileName: file.fileName,
        status: 'imported',
        batchId: batch.id,
        imported: file.transactions.length,
        duplicateFile: false,
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
