import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService) {}

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

      results.push({
        fileName: file.originalname,
        status: 'queued',
        batchId: batch.id,
        message: 'File queued for processing',
      });
    }

    return results;
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
