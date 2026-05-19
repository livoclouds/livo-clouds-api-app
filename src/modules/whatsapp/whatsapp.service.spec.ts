import { createHmac, randomBytes } from 'crypto';
import {
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { encrypt, decrypt, verifyHmacSha256 } from '../../common/utils/encryption.util';
import { WhatsAppBotService } from './whatsapp-bot.service';

// ─── Encryption ───────────────────────────────────────────────────────────────

describe('encryption.util', () => {
  const key = randomBytes(32).toString('hex');

  it('round-trips plaintext through encrypt → decrypt', () => {
    const plaintext = 'EAABsbCS2npkBAF...super-secret-token';
    const { ciphertext, iv, authTag } = encrypt(plaintext, key);
    expect(decrypt(ciphertext, iv, authTag, key)).toBe(plaintext);
  });

  it('throws on wrong key', () => {
    const { ciphertext, iv, authTag } = encrypt('hello', key);
    const wrongKey = randomBytes(32).toString('hex');
    expect(() => decrypt(ciphertext, iv, authTag, wrongKey)).toThrow('Decryption failed');
  });

  it('throws on tampered ciphertext', () => {
    const { iv, authTag } = encrypt('hello', key);
    const tampered = randomBytes(32).toString('base64');
    expect(() => decrypt(tampered, iv, authTag, key)).toThrow('Decryption failed');
  });
});

// ─── HMAC verification ────────────────────────────────────────────────────────

describe('verifyHmacSha256', () => {
  const secret = 'test-app-secret';
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));

  function sign(buf: Buffer, sec: string) {
    return 'sha256=' + createHmac('sha256', sec).update(buf).digest('hex');
  }

  it('accepts a valid signature', () => {
    const sig = sign(body, secret);
    expect(verifyHmacSha256(body, sig, secret)).toBe(true);
  });

  it('rejects tampered body', () => {
    const sig = sign(body, secret);
    const tampered = Buffer.from('{"object":"different"}');
    expect(verifyHmacSha256(tampered, sig, secret)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const sig = sign(body, 'wrong-secret');
    expect(verifyHmacSha256(body, sig, secret)).toBe(false);
  });

  it('rejects missing sha256= prefix but tries hex directly', () => {
    const hexOnly = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmacSha256(body, hexOnly, secret)).toBe(true);
  });

  it('rejects empty signature', () => {
    expect(verifyHmacSha256(body, '', secret)).toBe(false);
  });
});

// ─── Bot FAQ Matching ─────────────────────────────────────────────────────────

function makeFaq(triggers: string[], answer = 'Test answer', sortOrder = 0) {
  return {
    id: Math.random().toString(36).slice(2),
    condominiumId: 'condo-1',
    category: null,
    triggers,
    answer,
    sortOrder,
    isActive: true,
    usageCount: 0,
    lastUsedAt: null,
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makePrismaMock(faqs: ReturnType<typeof makeFaq>[]) {
  return {
    whatsAppFaq: {
      findMany: jest.fn().mockResolvedValue(faqs),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppConversation: {
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppMessage: {
      create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    },
  };
}

function makeMetaMock() {
  return {
    sendTextMessage: jest.fn().mockResolvedValue({ messageId: 'wamid.test123' }),
  };
}

function makeBotService(prisma: ReturnType<typeof makePrismaMock>, meta = makeMetaMock()) {
  const configService = { get: jest.fn().mockReturnValue('a'.repeat(64)) };
  const dispatcher = { dispatchEscalation: jest.fn().mockResolvedValue(undefined) };
  return new WhatsAppBotService(
    prisma as never,
    meta as never,
    configService as never,
    dispatcher as never,
  );
}

describe('WhatsAppBotService.matchFaq', () => {
  it('returns null when no FAQs exist', async () => {
    const svc = makeBotService(makePrismaMock([]));
    expect(await svc.matchFaq('condo-1', 'hello')).toBeNull();
  });

  it('matches an exact trigger', async () => {
    const faq = makeFaq(['cuota mensual']);
    const svc = makeBotService(makePrismaMock([faq]));
    const result = await svc.matchFaq('condo-1', 'cuota mensual');
    expect(result?.id).toBe(faq.id);
  });

  it('matches case-insensitively', async () => {
    const faq = makeFaq(['cuota mensual']);
    const svc = makeBotService(makePrismaMock([faq]));
    expect(await svc.matchFaq('condo-1', 'CUOTA MENSUAL')).not.toBeNull();
  });

  it('matches with diacritic folding (administración → administracion)', async () => {
    const faq = makeFaq(['administracion']);
    const svc = makeBotService(makePrismaMock([faq]));
    expect(await svc.matchFaq('condo-1', '¿Cómo contacto a la administración?')).not.toBeNull();
  });

  it('does NOT match partial-word when trigger is whole word', async () => {
    const faq = makeFaq(['admin']);
    const svc = makeBotService(makePrismaMock([faq]));
    expect(await svc.matchFaq('condo-1', 'administrator')).toBeNull();
  });

  it('matches whole word embedded in sentence', async () => {
    const faq = makeFaq(['admin']);
    const svc = makeBotService(makePrismaMock([faq]));
    expect(await svc.matchFaq('condo-1', 'necesito hablar con el admin hoy')).not.toBeNull();
  });

  it('picks longest trigger when two triggers match', async () => {
    const faqShort = makeFaq(['pago'], 'Short answer', 1);
    const faqLong = makeFaq(['fecha de pago'], 'Long answer', 0);
    const svc = makeBotService(makePrismaMock([faqShort, faqLong]));
    const result = await svc.matchFaq('condo-1', '¿cuál es la fecha de pago?');
    expect(result?.answer).toBe('Long answer');
  });

  it('returns null when message does not match any trigger', async () => {
    const faq = makeFaq(['cuota mensual']);
    const svc = makeBotService(makePrismaMock([faq]));
    expect(await svc.matchFaq('condo-1', 'hola buenos días')).toBeNull();
  });
});

// ─── Bot Pipeline — Miss Counter ──────────────────────────────────────────────

function makeConversation(overrides: Partial<{ consecutiveFaqMisses: number; status: WhatsAppConversationStatus }> = {}) {
  return {
    id: 'conv-1',
    condominiumId: 'condo-1',
    phoneNumber: '+521234567890',
    status: WhatsAppConversationStatus.BOT_ACTIVE,
    consecutiveFaqMisses: 0,
    residentId: null,
    unregisteredContactId: null,
    contactName: null,
    isOutOfHoursQueue: false,
    lastInboundAt: null,
    lastOutboundAt: null,
    escalatedAt: null,
    takenOverByUserId: null,
    takenOverAt: null,
    resolvedAt: null,
    resolvedByUserId: null,
    unreadCountForAdmin: 0,
    isSystemChannel: false,
    firstNotifiedAt: null,
    reNotifiedAt: null,
    beRightWithYouSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMessage(textContent: string) {
  return {
    id: 'msg-inbound-1',
    conversationId: 'conv-1',
    direction: WhatsAppMessageDirection.INBOUND,
    messageType: WhatsAppMessageType.TEXT,
    textContent,
    metaMessageId: 'wamid.abc',
    status: WhatsAppMessageStatus.RECEIVED,
    sentByBot: false,
    sentByUserId: null,
    mediaMetaId: null,
    mediaMimeType: null,
    mediaFilename: null,
    mediaCaption: null,
    mediaSizeBytes: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    deliveredAt: null,
    readAt: null,
  };
}

function makeBotConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    condominiumId: 'condo-1',
    isEnabled: true,
    welcomeMessage: 'Bienvenido',
    fallbackMessage: 'No encontré respuesta',
    escalationMessage: 'Te conectaré con un administrador',
    offHoursMessage: 'Fuera de horario',
    escalationKeywords: ['humano', 'admin', 'persona'],
    identityCaptureEnabled: false,
    identityCapturePrompt: '',
    whitelistEnabled: false,
    whitelistedPhoneNumbers: [],
    conversationRetentionDays: 90,
    returnToBotMessage: null,
    beRightWithYouMessage: 'Recibí tu mensaje. La administración te responderá tan pronto sea posible.',
    reNotifyAfterMinutes: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCtx(
  conversationOverrides: Partial<{ consecutiveFaqMisses: number }> = {},
  botConfigOverrides: Record<string, unknown> = {},
  messageText = 'mensaje sin coincidencia',
) {
  const { ciphertext, iv, authTag } = encrypt('fake-token', 'a'.repeat(64));
  return {
    conversation: makeConversation(conversationOverrides),
    inboundMessage: makeMessage(messageText),
    botConfig: makeBotConfig(botConfigOverrides),
    phoneNumberId: 'phone-number-id',
    accessTokenCiphertext: ciphertext,
    accessTokenIv: iv,
    accessTokenAuthTag: authTag,
  };
}

describe('WhatsAppBotService.processBotPipeline — miss counter', () => {
  it('first miss: sends fallback, increments consecutiveFaqMisses to 1', async () => {
    const prisma = makePrismaMock([]);
    const meta = makeMetaMock();
    const svc = makeBotService(prisma, meta);
    const ctx = makeCtx({ consecutiveFaqMisses: 0 });

    await svc.processBotPipeline(ctx);

    expect(meta.sendTextMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      ctx.botConfig.fallbackMessage,
    );
    expect(prisma.whatsAppConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFaqMisses: 1 }),
      }),
    );
  });

  it('second miss: sends escalation message, sets status ESCALATED', async () => {
    const prisma = makePrismaMock([]);
    const meta = makeMetaMock();
    const svc = makeBotService(prisma, meta);
    const ctx = makeCtx({ consecutiveFaqMisses: 1 });

    await svc.processBotPipeline(ctx);

    expect(meta.sendTextMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      ctx.botConfig.escalationMessage,
    );
    expect(prisma.whatsAppConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ESCALATED' }),
      }),
    );
  });
});

describe('WhatsAppBotService.processBotPipeline — escalation keyword', () => {
  it('escalates immediately on keyword match even if FAQ would match', async () => {
    const faq = makeFaq(['humano'], 'FAQ answer for human');
    const prisma = makePrismaMock([faq]);
    const meta = makeMetaMock();
    const svc = makeBotService(prisma, meta);
    const ctx = makeCtx({}, {}, 'necesito un humano');

    await svc.processBotPipeline(ctx);

    expect(meta.sendTextMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      ctx.botConfig.escalationMessage,
    );
    expect(prisma.whatsAppConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ESCALATED' }),
      }),
    );
  });
});

describe('WhatsAppBotService.processBotPipeline — bot disabled', () => {
  it('escalates immediately when bot is disabled', async () => {
    const prisma = makePrismaMock([]);
    const meta = makeMetaMock();
    const svc = makeBotService(prisma, meta);
    const ctx = makeCtx({}, { isEnabled: false });

    await svc.processBotPipeline(ctx);

    expect(prisma.whatsAppConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ESCALATED' }),
      }),
    );
  });
});

describe('WhatsAppBotService.processBotPipeline — FAQ match resets miss counter', () => {
  it('sends FAQ answer and resets consecutiveFaqMisses to 0', async () => {
    const faq = makeFaq(['cuota']);
    const prisma = makePrismaMock([faq]);
    const meta = makeMetaMock();
    const svc = makeBotService(prisma, meta);
    const ctx = makeCtx({ consecutiveFaqMisses: 1 }, {}, 'tengo una pregunta sobre la cuota');

    await svc.processBotPipeline(ctx);

    expect(meta.sendTextMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      faq.answer,
    );
    expect(prisma.whatsAppConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFaqMisses: 0 }),
      }),
    );
  });
});
