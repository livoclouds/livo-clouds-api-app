import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { R2AccessType } from '@prisma/client';

export interface AccessLogContext {
  userId?: string | null;
  condominiumId?: string | null;
  byteSize?: number | null;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly configured: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const accountId = config.get<string>('storage.accountId');
    const accessKeyId = config.get<string>('storage.accessKeyId');
    const secretAccessKey = config.get<string>('storage.secretAccessKey');
    this.bucket = config.get<string>('storage.bucketName') ?? '';

    this.configured = Boolean(
      accountId && accessKeyId && secretAccessKey && this.bucket,
    );

    if (this.configured) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!,
        },
      });
    } else {
      this.client = null;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getBucketName(): string {
    return this.bucket;
  }

  getClient(): S3Client {
    if (!this.client) throw new Error('External storage is not configured');
    return this.client;
  }

  async uploadFile(
    key: string,
    buffer: Buffer,
    mimeType: string,
    ctx?: AccessLogContext,
  ): Promise<string> {
    if (!this.client) throw new Error('External storage is not configured');
    console.log(
      `[StorageService] uploadFile: bucket=${this.bucket}, key=${key}, size=${buffer.length}B`,
    );
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    console.log(`[StorageService] uploadFile: success, key=${key}`);
    await this.recordAccess(key, R2AccessType.UPLOAD, {
      ...ctx,
      byteSize: ctx?.byteSize ?? buffer.length,
    });
    return key;
  }

  /**
   * Sign a temporary GET URL for an object.
   *
   * `log` defaults to `true` and records an R2 access-log entry. Pass `false`
   * for high-frequency, low-sensitivity thumbnails (e.g. avatar clusters in
   * list views) where logging every presign would flood the audit table.
   */
  async getPresignedUrl(
    key: string,
    expiresIn = 3600,
    ctx?: AccessLogContext,
    log = true,
  ): Promise<string> {
    if (!this.client) throw new Error('External storage is not configured');
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    if (log) await this.recordAccess(key, R2AccessType.PRESIGNED_GET, ctx);
    return url;
  }

  async downloadFile(key: string, ctx?: AccessLogContext): Promise<Buffer> {
    if (!this.client) throw new Error('External storage is not configured');
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`Storage object not found: ${key}`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    await this.recordAccess(key, R2AccessType.STREAM, {
      ...ctx,
      byteSize: ctx?.byteSize ?? buffer.length,
    });
    return buffer;
  }

  async deleteFile(key: string, ctx?: AccessLogContext): Promise<void> {
    if (!this.client) throw new Error('External storage is not configured');
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    await this.recordAccess(key, R2AccessType.DELETE, ctx);
  }

  private async recordAccess(
    objectKey: string,
    accessType: R2AccessType,
    ctx?: AccessLogContext,
  ): Promise<void> {
    try {
      await this.prisma.r2AccessLog.create({
        data: {
          objectKey,
          bucket: this.bucket || null,
          accessType,
          userId: ctx?.userId ?? null,
          condominiumId: ctx?.condominiumId ?? null,
          byteSize: ctx?.byteSize ?? null,
        },
      });
    } catch (err) {
      console.warn(
        `[StorageService] recordAccess failed (key=${objectKey}, type=${accessType}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
