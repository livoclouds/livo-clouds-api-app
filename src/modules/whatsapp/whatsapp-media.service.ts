import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../../common/types';
import { decrypt } from '../../common/utils/encryption.util';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { WhatsAppMediaRateLimitService } from './whatsapp-media-rate-limit.service';

export interface MediaStreamResult {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: string | null;
}

/**
 * Lazy media proxy: resolves a stored Meta media reference into a live byte
 * stream on demand. Nothing is persisted to R2 or local disk — Meta retains the
 * media for ~30 days and we proxy it through per request.
 */
@Injectable()
export class WhatsAppMediaService {
  private readonly logger = new Logger(WhatsAppMediaService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private metaClient: WhatsAppMetaClientService,
    private auditService: AuditService,
    private rateLimiter: WhatsAppMediaRateLimitService,
  ) {}

  async fetchMediaStream(
    condominiumId: string,
    conversationId: string,
    messageId: string,
    user: JwtPayload,
  ): Promise<MediaStreamResult> {
    const rate = this.rateLimiter.consume(user.sub);
    if (!rate.allowed) {
      await this.auditService.log({
        condominiumId,
        userId: user.sub,
        action: 'WHATSAPP_MEDIA_RATE_LIMITED',
        actionCategory: 'COMMUNICATIONS',
        module: 'WHATSAPP',
        entityType: 'WhatsAppMessage',
        entityId: messageId,
        result: 'WARNING',
        description: 'Media proxy rate limit exceeded',
      });
      throw new HttpException(
        {
          code: 'WHATSAPP_RATE_LIMITED',
          message: 'Media view rate limit exceeded',
          retryAfterSec: rate.retryAfterSec,
        },
        429,
      );
    }

    const message = await this.prisma.whatsAppMessage.findFirst({
      where: { id: messageId, conversationId, conversation: { condominiumId } },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (!message.mediaMetaId) {
      throw new HttpException(
        { code: 'WHATSAPP_MEDIA_NOT_AVAILABLE', message: 'Message has no media attachment' },
        400,
      );
    }
    if (message.mediaMimeType === 'image/svg+xml') {
      throw new HttpException(
        { code: 'WHATSAPP_MEDIA_UNSUPPORTED', message: 'This media type is not supported' },
        415,
      );
    }

    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId },
    });
    if (!credential) {
      throw new HttpException(
        { code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp is not configured' },
        502,
      );
    }

    const encryptionKey = this.configService.get<string>('whatsapp.encryptionKey', '');
    const accessToken = decrypt(
      credential.accessTokenCiphertext,
      credential.accessTokenIv,
      credential.accessTokenAuthTag,
      encryptionKey,
    );

    let metadata;
    try {
      metadata = await this.metaClient.getMediaUrl(message.mediaMetaId, accessToken);
    } catch (err) {
      this.logger.error(`[media] getMediaUrl failed: ${(err as Error).message}`);
      throw new HttpException(
        { code: 'WHATSAPP_CONNECTION_ERROR', message: 'Could not reach WhatsApp media service' },
        502,
      );
    }

    if (!metadata) {
      await this.markMediaExpired(message.id);
      throw new HttpException(
        { code: 'WHATSAPP_MEDIA_EXPIRED', message: 'This media is no longer available' },
        410,
      );
    }

    let download;
    try {
      download = await this.metaClient.downloadMedia(metadata.url, accessToken);
    } catch (err) {
      this.logger.error(`[media] downloadMedia failed: ${(err as Error).message}`);
      throw new HttpException(
        { code: 'WHATSAPP_CONNECTION_ERROR', message: 'Could not reach WhatsApp media service' },
        502,
      );
    }

    if (!download) {
      await this.markMediaExpired(message.id);
      throw new HttpException(
        { code: 'WHATSAPP_MEDIA_EXPIRED', message: 'This media is no longer available' },
        410,
      );
    }

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_MEDIA_VIEWED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppMessage',
      entityId: message.id,
      afterState: { messageId: message.id, mediaMimeType: message.mediaMimeType },
      result: 'SUCCESS',
      description: 'Admin viewed WhatsApp media',
    });

    return {
      stream: download.stream,
      contentType: metadata.mimeType || download.contentType,
      contentLength:
        download.contentLength ?? (metadata.fileSize ? String(metadata.fileSize) : null),
    };
  }

  private async markMediaExpired(messageId: string): Promise<void> {
    await this.prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: { errorMessage: 'Meta media expired' },
    });
  }
}
