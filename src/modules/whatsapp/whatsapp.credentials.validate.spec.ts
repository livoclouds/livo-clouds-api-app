import { PreconditionFailedException } from '@nestjs/common';
import { encrypt } from '../../common/utils/encryption.util';
import { WhatsAppService } from './whatsapp.service';
import type { PhoneValidationResult } from './whatsapp-meta-client.service';

const KEY = 'a'.repeat(64);

function makeCredential() {
  const enc = encrypt('meta-token', KEY);
  return {
    id: 'cred-1',
    condominiumId: 'condo-1',
    phoneNumberId: 'pn-1',
    accessTokenCiphertext: enc.ciphertext,
    accessTokenIv: enc.iv,
    accessTokenAuthTag: enc.authTag,
  };
}

function metaResult(overrides: Partial<PhoneValidationResult>): PhoneValidationResult {
  return {
    isWhatsAppBusiness: true,
    hasMessagesPermission: true,
    currentStatus: 'CONNECTED',
    displayPhoneNumber: '+528112345678',
    codeVerificationStatus: 'VERIFIED',
    failed: false,
    failureKind: null,
    ...overrides,
  };
}

function makeService(opts: {
  credential: ReturnType<typeof makeCredential> | null;
  meta: PhoneValidationResult;
}) {
  const prisma = {
    whatsAppCredential: {
      findUnique: jest.fn().mockResolvedValue(opts.credential),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const configService = { get: jest.fn().mockReturnValue(KEY) };
  const auditService = { log: jest.fn().mockResolvedValue({}) };
  const metaClient = {
    validatePhoneNumber: jest.fn().mockResolvedValue(opts.meta),
  };
  const service = new WhatsAppService(
    prisma as never,
    configService as never,
    auditService as never,
    metaClient as never,
    {} as never,
  );
  return { service, prisma, metaClient };
}

describe('WhatsAppService.validateNumber', () => {
  it('returns CONFIRMED for a verified WhatsApp Business number', async () => {
    const { service } = makeService({
      credential: makeCredential(),
      meta: metaResult({ codeVerificationStatus: 'VERIFIED' }),
    });

    const result = await service.validateNumber('condo-1', { phoneNumber: '+528112345678' });

    expect(result.status).toBe('CONFIRMED');
    expect(result.isWhatsAppBusiness).toBe(true);
    expect(result.normalizedPhoneNumber).toBe('+528112345678');
  });

  it('returns NOT_READY when the number exists but is not verified', async () => {
    const { service } = makeService({
      credential: makeCredential(),
      meta: metaResult({ codeVerificationStatus: 'NOT_VERIFIED' }),
    });

    const result = await service.validateNumber('condo-1', { phoneNumber: '+528112345678' });

    expect(result.status).toBe('NOT_READY');
    expect(result.recommendedNextStep).toBe('completeVerification');
  });

  it('returns NOT_BUSINESS when Meta rejects the lookup (regular WhatsApp)', async () => {
    const { service } = makeService({
      credential: makeCredential(),
      meta: metaResult({ failed: true, failureKind: 'http', isWhatsAppBusiness: false }),
    });

    const result = await service.validateNumber('condo-1', { phoneNumber: '+528112345678' });

    expect(result.status).toBe('NOT_BUSINESS');
    expect(result.isWhatsAppBusiness).toBe(false);
    expect(result.recommendedNextStep).toBe('migrateToBusiness');
  });

  it('returns ERROR when the Meta API is unreachable', async () => {
    const { service } = makeService({
      credential: makeCredential(),
      meta: metaResult({ failed: true, failureKind: 'network', isWhatsAppBusiness: false }),
    });

    const result = await service.validateNumber('condo-1', { phoneNumber: '+528112345678' });

    expect(result.status).toBe('ERROR');
    expect(result.recommendedNextStep).toBe('retryLater');
  });

  it('normalizes a bare 10-digit number before responding', async () => {
    const { service } = makeService({
      credential: makeCredential(),
      meta: metaResult({}),
    });

    const result = await service.validateNumber('condo-1', { phoneNumber: '8112345678' });

    expect(result.normalizedPhoneNumber).toBe('+528112345678');
  });

  it('throws when no credential is configured', async () => {
    const { service } = makeService({ credential: null, meta: metaResult({}) });

    await expect(
      service.validateNumber('condo-1', { phoneNumber: '+528112345678' }),
    ).rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it('does not leak the access token or raw Meta error in the response', async () => {
    const { service } = makeService({
      credential: makeCredential(),
      meta: metaResult({ failed: true, failureKind: 'http', isWhatsAppBusiness: false }),
    });

    const result = await service.validateNumber('condo-1', { phoneNumber: '+528112345678' });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('meta-token');
    expect(Object.keys(result).sort()).toEqual(
      ['isWhatsAppBusiness', 'normalizedPhoneNumber', 'reason', 'recommendedNextStep', 'status'].sort(),
    );
  });
});
