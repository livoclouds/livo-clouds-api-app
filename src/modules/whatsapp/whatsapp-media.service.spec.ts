import { HttpException, NotFoundException } from '@nestjs/common';
import { encrypt } from '../../common/utils/encryption.util';
import { WhatsAppMediaService } from './whatsapp-media.service';

const KEY = 'a'.repeat(64);
const USER = { sub: 'user-1' } as never;

function makeCredential() {
  const enc = encrypt('fake-token', KEY);
  return {
    phoneNumberId: 'pn',
    accessTokenCiphertext: enc.ciphertext,
    accessTokenIv: enc.iv,
    accessTokenAuthTag: enc.authTag,
  };
}

function makeDeps(opts: {
  message?: unknown;
  rateAllowed?: boolean;
  mediaUrl?: unknown;
  download?: unknown;
} = {}) {
  const prisma = {
    whatsAppMessage: {
      findFirst: jest.fn().mockResolvedValue(
        opts.message === undefined
          ? {
              id: 'msg-1',
              conversationId: 'conv-1',
              mediaMetaId: 'media-1',
              mediaMimeType: 'image/jpeg',
            }
          : opts.message,
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppCredential: {
      findUnique: jest.fn().mockResolvedValue(makeCredential()),
    },
  };
  const configService = { get: jest.fn().mockReturnValue(KEY) };
  const metaClient = {
    getMediaUrl: jest.fn().mockResolvedValue(
      opts.mediaUrl === undefined
        ? { url: 'https://lookaside.meta/abc', mimeType: 'image/jpeg', sha256: 'x', fileSize: 2048 }
        : opts.mediaUrl,
    ),
    downloadMedia: jest.fn().mockResolvedValue(
      opts.download === undefined
        ? { stream: {}, contentType: 'image/jpeg', contentLength: '2048' }
        : opts.download,
    ),
  };
  const auditService = { log: jest.fn().mockResolvedValue({}) };
  const rateLimiter = {
    consume: jest.fn().mockReturnValue({
      allowed: opts.rateAllowed ?? true,
      remaining: 199,
      retryAfterSec: opts.rateAllowed === false ? 1800 : 0,
    }),
  };
  const service = new WhatsAppMediaService(
    prisma as never,
    configService as never,
    metaClient as never,
    auditService as never,
    rateLimiter as never,
  );
  return { service, prisma, metaClient, auditService, rateLimiter };
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    throw new Error('expected the promise to reject');
  } catch (err) {
    if (err instanceof HttpException) return err.getStatus();
    throw err;
  }
}

describe('WhatsAppMediaService.fetchMediaStream', () => {
  it('streams media bytes and audits the view', async () => {
    const { service, auditService } = makeDeps();

    const result = await service.fetchMediaStream('condo-1', 'conv-1', 'msg-1', USER);

    expect(result.contentType).toBe('image/jpeg');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_MEDIA_VIEWED' }),
    );
  });

  it('returns 429 and audits when the rate limit is exceeded', async () => {
    const { service, auditService } = makeDeps({ rateAllowed: false });

    expect(await statusOf(service.fetchMediaStream('condo-1', 'conv-1', 'msg-1', USER))).toBe(429);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_MEDIA_RATE_LIMITED' }),
    );
  });

  it('returns 410 when Meta reports the media as expired', async () => {
    const { service, prisma } = makeDeps({ mediaUrl: null });

    expect(await statusOf(service.fetchMediaStream('condo-1', 'conv-1', 'msg-1', USER))).toBe(410);
    expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { errorMessage: 'Meta media expired' } }),
    );
  });

  it('rejects SVG media with 415', async () => {
    const { service } = makeDeps({
      message: {
        id: 'msg-1',
        conversationId: 'conv-1',
        mediaMetaId: 'media-1',
        mediaMimeType: 'image/svg+xml',
      },
    });

    expect(await statusOf(service.fetchMediaStream('condo-1', 'conv-1', 'msg-1', USER))).toBe(415);
  });

  it('throws 404 when the message does not belong to the conversation', async () => {
    const { service } = makeDeps({ message: null });

    await expect(
      service.fetchMediaStream('condo-1', 'conv-1', 'msg-x', USER),
    ).rejects.toThrow(NotFoundException);
  });
});
