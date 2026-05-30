import { WebPushService } from './web-push.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
import * as webpush from 'web-push';

const VALID_SUB = {
  endpoint: 'https://push.test/abc',
  keys: { p256dh: 'pkey', auth: 'akey' },
};

const PAYLOAD = {
  title: 'Conversación escalada',
  body: 'Casa 12 necesita atención',
  tag: 'whatsapp-conversation-c1',
  url: '/communications/c1',
};

function makeService(opts: { configured?: boolean } = {}) {
  const prisma = {
    whatsAppNotificationPreference: { update: jest.fn().mockResolvedValue({}) },
  };
  const configService = {
    get: jest.fn((key: string, fallback: string) => {
      if (opts.configured === false) {
        if (key === 'webPush.publicKey') return '';
        if (key === 'webPush.privateKey') return '';
        return fallback;
      }
      if (key === 'webPush.publicKey') return 'public-key';
      if (key === 'webPush.privateKey') return 'private-key';
      if (key === 'webPush.subject') return 'mailto:test@livoclouds.com';
      return fallback;
    }),
  };
  const service = new WebPushService(prisma as never, configService as never);
  return { service, prisma };
}

describe('WebPushService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports not configured when VAPID keys are absent', () => {
    const { service } = makeService({ configured: false });
    expect(service.isConfigured()).toBe(false);
  });

  it('configures VAPID details once when keys are present', () => {
    const { service } = makeService();
    expect(service.isConfigured()).toBe(true);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:test@livoclouds.com',
      'public-key',
      'private-key',
    );
  });

  it('delivers a privacy-safe payload with title, body, tag and url', async () => {
    const { service } = makeService();
    (webpush.sendNotification as jest.Mock).mockResolvedValue({});
    const ok = await service.sendToPreference('pref-1', VALID_SUB, PAYLOAD);
    expect(ok).toBe(true);
    const [, payload] = (webpush.sendNotification as jest.Mock).mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual(PAYLOAD);
  });

  it('skips delivery when the stored subscription JSON is malformed', async () => {
    const { service } = makeService();
    const ok = await service.sendToPreference('pref-1', { endpoint: 'https://x' }, PAYLOAD);
    expect(ok).toBe(false);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('clears an expired subscription when delivery returns 410 Gone', async () => {
    const { service, prisma } = makeService();
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 410 });
    const ok = await service.sendToPreference('pref-1', VALID_SUB, PAYLOAD);
    expect(ok).toBe(false);
    expect(prisma.whatsAppNotificationPreference.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pref-1' } }),
    );
  });

  it('keeps the subscription on a transient (500) delivery error', async () => {
    const { service, prisma } = makeService();
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 500 });
    const ok = await service.sendToPreference('pref-1', VALID_SUB, PAYLOAD);
    expect(ok).toBe(false);
    expect(prisma.whatsAppNotificationPreference.update).not.toHaveBeenCalled();
  });

  it('never throws — a delivery failure resolves to false', async () => {
    const { service } = makeService();
    (webpush.sendNotification as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(service.sendToPreference('pref-1', VALID_SUB, PAYLOAD)).resolves.toBe(
      false,
    );
  });

  it('skips dispatch entirely when VAPID is not configured', async () => {
    const { service } = makeService({ configured: false });
    const ok = await service.sendToPreference('pref-1', VALID_SUB, PAYLOAD);
    expect(ok).toBe(false);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
