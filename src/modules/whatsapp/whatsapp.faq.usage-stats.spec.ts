import { encrypt } from '../../common/utils/encryption.util';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppBotService } from './whatsapp-bot.service';

function makeFaq(overrides: Record<string, unknown> = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    condominiumId: 'condo-1',
    category: null,
    triggers: ['cuota'],
    answer: 'Respuesta',
    sortOrder: 0,
    isActive: true,
    usageCount: 0,
    lastUsedAt: null,
    createdByUserId: 'u',
    updatedByUserId: 'u',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('WhatsAppService.getFaqUsageStats', () => {
  it('aggregates totals, top FAQs, and unused FAQs', async () => {
    const faqs = [
      makeFaq({ usageCount: 40, lastUsedAt: new Date('2026-05-18T00:00:00Z') }),
      makeFaq({ usageCount: 12, lastUsedAt: new Date('2026-05-19T00:00:00Z') }),
      makeFaq({ usageCount: 0, isActive: true }),
      makeFaq({ usageCount: 0, isActive: false }),
    ];
    const prisma = {
      whatsAppFaq: { findMany: jest.fn().mockResolvedValue(faqs) },
    };
    const service = new WhatsAppService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const stats = await service.getFaqUsageStats('condo-1');

    expect(stats.totalFaqs).toBe(4);
    expect(stats.activeFaqs).toBe(3);
    expect(stats.totalMatches).toBe(52);
    expect(stats.topFaqs).toHaveLength(2);
    expect(stats.unusedFaqs).toHaveLength(2);
    expect(stats.lastUsedAt).toEqual(new Date('2026-05-19T00:00:00Z'));
  });
});

// ─── usageCount is incremented only on a successful FAQ match ──────────────────

function makeBotPrisma(faqs: ReturnType<typeof makeFaq>[]) {
  return {
    whatsAppFaq: {
      findMany: jest.fn().mockResolvedValue(faqs),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppConversation: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    whatsAppMessage: { create: jest.fn().mockResolvedValue({ id: 'm' }) },
    whatsAppUnregisteredContact: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    condominiumSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

function makeBotService(prisma: ReturnType<typeof makeBotPrisma>) {
  return new WhatsAppBotService(
    prisma as never,
    { sendTextMessage: jest.fn().mockResolvedValue({ messageId: 'x' }) } as never,
    { get: jest.fn().mockReturnValue('a'.repeat(64)) } as never,
    { dispatchEscalation: jest.fn().mockResolvedValue(undefined) } as never,
    { tryCaptureIdentity: jest.fn().mockResolvedValue({ matchedResidentId: null }) } as never,
  );
}

function makeCtx(text: string) {
  const enc = encrypt('token', 'a'.repeat(64));
  return {
    conversation: {
      id: 'conv-1',
      condominiumId: 'condo-1',
      phoneNumber: '+528111111111',
      status: 'BOT_ACTIVE',
      consecutiveFaqMisses: 0,
      residentId: null,
      unregisteredContactId: null,
    },
    inboundMessage: { id: 'in-1', textContent: text },
    botConfig: {
      id: 'bc-1',
      isEnabled: true,
      whitelistEnabled: false,
      whitelistedPhoneNumbers: [],
      escalationKeywords: ['humano'],
      escalationMessage: 'Escalando',
      fallbackMessage: 'No encontré',
      identityCaptureEnabled: false,
      offHoursMessage: 'Cerrado',
    },
    phoneNumberId: 'pn-1',
    accessTokenCiphertext: enc.ciphertext,
    accessTokenIv: enc.iv,
    accessTokenAuthTag: enc.authTag,
  };
}

describe('WhatsAppBotService — FAQ usageCount increment', () => {
  it('increments usageCount on a successful match', async () => {
    const prisma = makeBotPrisma([makeFaq({ triggers: ['cuota'] })]);
    const svc = makeBotService(prisma);

    await svc.processBotPipeline(makeCtx('pregunta sobre la cuota') as never);

    expect(prisma.whatsAppFaq.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { usageCount: { increment: 1 }, lastUsedAt: expect.any(Date) },
      }),
    );
  });

  it('does NOT increment usageCount when no FAQ matches', async () => {
    const prisma = makeBotPrisma([makeFaq({ triggers: ['cuota'] })]);
    const svc = makeBotService(prisma);

    await svc.processBotPipeline(makeCtx('mensaje sin coincidencia') as never);

    expect(prisma.whatsAppFaq.update).not.toHaveBeenCalled();
  });
});
