import { BadRequestException } from '@nestjs/common';
import { WhatsAppNotifyChannel } from '@prisma/client';
import * as encryptionUtil from '../../common/utils/encryption.util';
import { WhatsAppNotificationPreferenceService } from './whatsapp-notification-preference.service';

function makeService(overrides: {
  existingPreference?: Record<string, unknown> | null;
  phoneConflict?: boolean;
  residentMatch?: boolean;
  credential?: Record<string, unknown> | null;
  recentInbound?: boolean;
  metaOk?: boolean;
} = {}) {
  const base = {
    id: 'pref-1',
    userId: 'user-1',
    condominiumId: 'condo-1',
    notifyOnEscalation: true,
    notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
    personalPhoneNumber: null as string | null,
    personalPhoneVerifiedAt: null as Date | null,
    reNotifyAfterMinutes: null as number | null,
  };

  const prisma = {
    whatsAppNotificationPreference: {
      upsert: jest
        .fn()
        .mockResolvedValue(overrides.existingPreference ?? base),
      update: jest.fn().mockImplementation(({ data }) => ({ ...base, ...(data as object) })),
      findFirst: jest.fn().mockResolvedValue(overrides.phoneConflict ? { id: 'other' } : null),
    },
    pushSubscription: {
      upsert: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    resident: {
      findFirst: jest.fn().mockResolvedValue(overrides.residentMatch ? { id: 'res-1' } : null),
    },
    whatsAppCredential: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.credential === undefined
          ? {
              phoneNumberId: 'pnid',
              accessTokenCiphertext: 'c',
              accessTokenIv: 'i',
              accessTokenAuthTag: 't',
              status: 'ACTIVE',
            }
          : overrides.credential,
      ),
    },
    whatsAppMessage: {
      findFirst: jest.fn().mockResolvedValue(overrides.recentInbound ? { id: 'm' } : null),
    },
  };

  const configService = { get: jest.fn().mockImplementation((_k, fb) => fb ?? 'x'.repeat(64)) };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const metaClient = {
    sendTextMessage: jest.fn(() =>
      overrides.metaOk === false ? Promise.reject(new Error('boom')) : Promise.resolve({ messageId: 'w' }),
    ),
    sendTemplateMessage: jest.fn(() =>
      overrides.metaOk === false ? Promise.reject(new Error('boom')) : Promise.resolve({ messageId: 'w' }),
    ),
  };

  jest.spyOn(encryptionUtil, 'decrypt').mockReturnValue('access-token');

  const service = new WhatsAppNotificationPreferenceService(
    prisma as never,
    configService as never,
    auditService as never,
    metaClient as never,
  );
  return { service, prisma, auditService, metaClient };
}

describe('WhatsAppNotificationPreferenceService.updateForCurrentUser', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emits audit event with PII redacted', async () => {
    const { service, auditService } = makeService();
    await service.updateForCurrentUser('condo-1', { sub: 'user-1' } as never, {
      notifyOnEscalation: false,
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WHATSAPP_NOTIFICATION_PREFERENCE_UPDATED',
        beforeState: expect.objectContaining({
          personalPhoneConfigured: false,
        }),
      }),
    );
    const call = auditService.log.mock.calls[0][0];
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('+528');
  });

  it('clears personalPhoneVerifiedAt when phone changes', async () => {
    const { service, prisma } = makeService({
      existingPreference: {
        id: 'p',
        notifyOnEscalation: true,
        notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
        personalPhoneNumber: '+528100000001',
        personalPhoneVerifiedAt: new Date(),
        reNotifyAfterMinutes: null,
      },
    });
    await service.updateForCurrentUser('condo-1', { sub: 'user-1' } as never, {
      personalPhoneNumber: '+528100000002',
    });
    const data = prisma.whatsAppNotificationPreference.update.mock.calls[0][0].data;
    expect(data.personalPhoneNumber).toBe('+528100000002');
    expect(data.personalPhoneVerifiedAt).toBeNull();
  });

  it('rejects when another admin has the phone number', async () => {
    const { service } = makeService({ phoneConflict: true });
    await expect(
      service.updateForCurrentUser('condo-1', { sub: 'user-1' } as never, {
        personalPhoneNumber: '+528100000099',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when phone matches a resident', async () => {
    const { service } = makeService({ residentMatch: true });
    await expect(
      service.updateForCurrentUser('condo-1', { sub: 'user-1' } as never, {
        personalPhoneNumber: '+528100000099',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('WhatsAppNotificationPreferenceService.sendTestWhatsApp', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses free-form when admin window is open', async () => {
    const { service, metaClient } = makeService({
      existingPreference: {
        id: 'p',
        notifyOnEscalation: true,
        notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
        personalPhoneNumber: '+528100000001',
        personalPhoneVerifiedAt: new Date(),
        reNotifyAfterMinutes: null,
      },
      recentInbound: true,
    });
    const result = await service.sendTestWhatsApp('condo-1', 'user-1');
    expect(result).toEqual({ ok: true, via: 'free-form' });
    expect(metaClient.sendTextMessage).toHaveBeenCalled();
  });

  it('uses template fallback when window is closed', async () => {
    const { service, metaClient } = makeService({
      existingPreference: {
        id: 'p',
        notifyOnEscalation: true,
        notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
        personalPhoneNumber: '+528100000001',
        personalPhoneVerifiedAt: new Date(),
        reNotifyAfterMinutes: null,
      },
      recentInbound: false,
    });
    const result = await service.sendTestWhatsApp('condo-1', 'user-1');
    expect(result).toEqual({ ok: true, via: 'template' });
    expect(metaClient.sendTemplateMessage).toHaveBeenCalled();
  });

  it('throws when no phone is configured and no override given', async () => {
    const { service } = makeService();
    await expect(service.sendTestWhatsApp('condo-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when credential is inactive', async () => {
    const { service } = makeService({
      existingPreference: {
        id: 'p',
        notifyOnEscalation: true,
        notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
        personalPhoneNumber: '+528100000001',
        personalPhoneVerifiedAt: new Date(),
        reNotifyAfterMinutes: null,
      },
      credential: null,
    });
    await expect(service.sendTestWhatsApp('condo-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('WhatsAppNotificationPreferenceService.savePushSubscription', () => {
  afterEach(() => jest.restoreAllMocks());

  const validSub = {
    endpoint: 'https://push.test/endpoint',
    expirationTime: null,
    keys: { p256dh: 'p256', auth: 'authkey' },
  };

  it('upserts the subscription by endpoint and audits without leaking the payload', async () => {
    const { service, prisma, auditService } = makeService();
    await service.savePushSubscription('condo-1', 'user-1', validSub);
    const call = prisma.pushSubscription.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ endpoint: 'https://push.test/endpoint' });
    expect(call.create).toEqual({
      userId: 'user-1',
      condominiumId: 'condo-1',
      endpoint: 'https://push.test/endpoint',
      p256dh: 'p256',
      auth: 'authkey',
    });
    // Re-registering the same browser refreshes its keys + lastSeenAt.
    expect(call.update).toMatchObject({ p256dh: 'p256', auth: 'authkey' });
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);
    // The legacy single-row field is no longer written.
    expect(prisma.whatsAppNotificationPreference.update).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_PUSH_SUBSCRIPTION_UPDATED' }),
    );
    const serialized = JSON.stringify(auditService.log.mock.calls[0][0]);
    expect(serialized).not.toContain('push.test');
  });

  it('rejects a payload missing the endpoint', async () => {
    const { service } = makeService();
    await expect(
      service.savePushSubscription('condo-1', 'user-1', {
        keys: { p256dh: 'p', auth: 'a' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a payload missing the encryption keys', async () => {
    const { service } = makeService();
    await expect(
      service.savePushSubscription('condo-1', 'user-1', {
        endpoint: 'https://push.test/x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an undefined subscription', async () => {
    const { service } = makeService();
    await expect(
      service.savePushSubscription('condo-1', 'user-1', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('drops extra client-supplied fields, persisting only the canonical shape', async () => {
    const { service, prisma } = makeService();
    await service.savePushSubscription('condo-1', 'user-1', {
      ...validSub,
      evilField: 'x',
    } as never);
    const call = prisma.pushSubscription.upsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('evilField');
    expect(JSON.stringify(call)).not.toContain('evilField');
  });
});

describe('WhatsAppNotificationPreferenceService.removePushSubscription', () => {
  afterEach(() => jest.restoreAllMocks());

  it('removes only the given device by endpoint and audits the removal', async () => {
    const { service, prisma, auditService } = makeService();
    const result = await service.removePushSubscription(
      'condo-1',
      'user-1',
      'https://push.test/endpoint',
    );
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', condominiumId: 'condo-1', endpoint: 'https://push.test/endpoint' },
    });
    expect(prisma.whatsAppNotificationPreference.update).not.toHaveBeenCalled();
    expect(result).toEqual({ removed: 1 });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WHATSAPP_PUSH_SUBSCRIPTION_REMOVED',
        afterState: expect.objectContaining({ scope: 'device' }),
      }),
    );
  });

  it('removes every device for the user when no endpoint is given', async () => {
    const { service, prisma, auditService } = makeService();
    await service.removePushSubscription('condo-1', 'user-1');
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', condominiumId: 'condo-1' },
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WHATSAPP_PUSH_SUBSCRIPTION_REMOVED',
        afterState: expect.objectContaining({ scope: 'all-devices' }),
      }),
    );
  });
});
