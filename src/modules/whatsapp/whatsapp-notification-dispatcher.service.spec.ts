import { WhatsAppConversationStatus, WhatsAppNotifyChannel } from '@prisma/client';
import * as encryptionUtil from '../../common/utils/encryption.util';
import { WhatsAppNotificationDispatcherService } from './whatsapp-notification-dispatcher.service';

function makeDispatcher(overrides: {
  conversation?: Record<string, unknown> | null;
  preferences?: Record<string, unknown>[];
  credential?: Record<string, unknown> | null;
  condominium?: { slug: string } | null;
  recentInbound?: boolean;
  metaTextOk?: boolean;
  metaTemplateOk?: boolean;
} = {}) {
  const sendTextMessage = jest.fn(() =>
    overrides.metaTextOk === false
      ? Promise.reject(new Error('meta-text-fail'))
      : Promise.resolve({ messageId: 'wamid.text' }),
  );
  const sendTemplateMessage = jest.fn(() =>
    overrides.metaTemplateOk === false
      ? Promise.reject(new Error('meta-template-fail'))
      : Promise.resolve({ messageId: 'wamid.template' }),
  );

  const prisma = {
    whatsAppConversation: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.conversation === undefined
          ? {
              id: 'conv-1',
              condominiumId: 'condo-1',
              phoneNumber: '+528111111111',
              status: WhatsAppConversationStatus.ESCALATED,
              contactName: null,
              firstNotifiedAt: null,
              reNotifiedAt: null,
              beRightWithYouSentAt: null,
              resident: { firstName: 'Juan', lastName: 'Pérez', unitNumber: '47' },
            }
          : overrides.conversation,
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppNotificationPreference: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          overrides.preferences ?? [
            {
              id: 'pref-1',
              userId: 'user-1',
              notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
              notifyOnEscalation: true,
              personalPhoneNumber: '+528122222222',
              personalPhoneVerifiedAt: new Date(),
            },
          ],
        ),
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
    condominium: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.condominium === undefined ? { slug: 'casa-azul' } : overrides.condominium,
      ),
    },
    whatsAppMessage: {
      findFirst: jest.fn().mockResolvedValue(overrides.recentInbound ? { id: 'm' } : null),
      create: jest.fn().mockResolvedValue({}),
    },
    whatsAppBotConfig: {
      findUnique: jest.fn().mockResolvedValue({ beRightWithYouMessage: 'be right back' }),
    },
  };

  const configService = {
    get: jest.fn((key: string, fallback: string) => {
      if (key === 'whatsapp.encryptionKey') return 'a'.repeat(64);
      if (key === 'whatsapp.webAppUrl') return 'https://app.test';
      if (key === 'whatsapp.escalationTemplateName') return 'escalation_notification';
      if (key === 'whatsapp.escalationTemplateLanguage') return 'es_MX';
      return fallback;
    }),
  };

  const metaClient = { sendTextMessage, sendTemplateMessage };

  // Replace decrypt via spying: bypass crypto by stubbing token shape - the service decrypts only on dispatch path
  jest.spyOn(encryptionUtil, 'decrypt').mockReturnValue('access-token');

  const service = new WhatsAppNotificationDispatcherService(
    prisma as never,
    configService as never,
    metaClient as never,
  );
  return { service, prisma, metaClient, sendTextMessage, sendTemplateMessage };
}

describe('WhatsAppNotificationDispatcherService.dispatchEscalation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends free-form notification when admin service window is open', async () => {
    const { service, sendTextMessage, prisma } = makeDispatcher({ recentInbound: true });
    await service.dispatchEscalation('conv-1');
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1', firstNotifiedAt: null } }),
    );
  });

  it('falls back to template when service window closed', async () => {
    const { service, sendTextMessage, sendTemplateMessage } = makeDispatcher({
      recentInbound: false,
    });
    await service.dispatchEscalation('conv-1');
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'pnid',
      'access-token',
      '+528122222222',
      'escalation_notification',
      'es_MX',
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'Casa 47' }),
      ]),
    );
  });

  it('skips when notifyChannel is NONE', async () => {
    const { service, sendTextMessage, sendTemplateMessage } = makeDispatcher({
      preferences: [
        {
          id: 'p',
          userId: 'u',
          notifyChannel: WhatsAppNotifyChannel.NONE,
          notifyOnEscalation: true,
          personalPhoneNumber: '+528122222222',
          personalPhoneVerifiedAt: new Date(),
        },
      ],
    });
    await service.dispatchEscalation('conv-1');
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('logs but does not throw when one admin send fails', async () => {
    const { service, sendTextMessage } = makeDispatcher({
      recentInbound: true,
      metaTextOk: false,
      preferences: [
        {
          id: 'p1',
          userId: 'u1',
          notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
          notifyOnEscalation: true,
          personalPhoneNumber: '+528100000001',
          personalPhoneVerifiedAt: new Date(),
        },
        {
          id: 'p2',
          userId: 'u2',
          notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
          notifyOnEscalation: true,
          personalPhoneNumber: '+528100000002',
          personalPhoneVerifiedAt: new Date(),
        },
      ],
    });
    await expect(service.dispatchEscalation('conv-1')).resolves.toBeUndefined();
    expect(sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it('does nothing when conversation is not ESCALATED', async () => {
    const { service, sendTextMessage } = makeDispatcher({
      conversation: {
        id: 'conv-1',
        condominiumId: 'condo-1',
        phoneNumber: '+528111111111',
        status: WhatsAppConversationStatus.ADMIN_HANDLING,
        contactName: null,
        firstNotifiedAt: null,
        reNotifiedAt: null,
        beRightWithYouSentAt: null,
        resident: null,
      },
    });
    await service.dispatchEscalation('conv-1');
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('skips preference without verified personal phone', async () => {
    const { service, sendTextMessage } = makeDispatcher({
      preferences: [
        {
          id: 'p',
          userId: 'u',
          notifyChannel: WhatsAppNotifyChannel.WHATSAPP,
          notifyOnEscalation: true,
          personalPhoneNumber: '+528122222222',
          personalPhoneVerifiedAt: null,
        },
      ],
    });
    await service.dispatchEscalation('conv-1');
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});

describe('WhatsAppNotificationDispatcherService.dispatchReNotification', () => {
  afterEach(() => jest.restoreAllMocks());

  it('marks conversation re-notified and triggers beRightWithYou when window open', async () => {
    const { service, prisma } = makeDispatcher({ recentInbound: true });
    await service.dispatchReNotification('conv-1');
    expect(prisma.whatsAppConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reNotifiedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.whatsAppMessage.create).toHaveBeenCalled();
  });

  it('does not re-notify when reNotifiedAt already set (updateMany returns 0)', async () => {
    const { service, prisma, sendTextMessage } = makeDispatcher();
    prisma.whatsAppConversation.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.dispatchReNotification('conv-1');
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
