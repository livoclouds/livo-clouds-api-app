import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly configured: boolean;

  constructor(private readonly config: ConfigService) {
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

  async uploadFile(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    if (!this.client) throw new Error('External storage is not configured');
    console.log(`[StorageService] uploadFile: bucket=${this.bucket}, key=${key}, size=${buffer.length}B`);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    console.log(`[StorageService] uploadFile: success, key=${key}`);
    return key;
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.client) throw new Error('External storage is not configured');
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.client) throw new Error('External storage is not configured');
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
