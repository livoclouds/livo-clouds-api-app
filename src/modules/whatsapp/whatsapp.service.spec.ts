import { createHmac, randomBytes } from 'crypto';
import {
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { encrypt, decrypt, verifyHmacSha256 } from '../../common/utils/encryption.util';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { WhatsAppService, extractMediaMeta } from './whatsapp.service';

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
      findUnique: jest.fn().mockResolvedValue(null),
    },
    whatsAppMessage: {
      create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    },
    whatsAppUnregisteredContact: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    condominiumSettings: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
}

function makeMetaMock() {
  return {
    sendTextMessage: jest.fn().mockResolvedValue({ messageId: 'wamid.test123' }),
  };
}

function makeIdentityCaptureMock() {
  return {
    tryCaptureIdentity: jest.fn().mockResolvedValue({ matchedResidentId: null }),
  };
}

function makeBotService(
  prisma: ReturnType<typeof makePrismaMock>,
  meta = makeMetaMock(),
  identityCapture = makeIdentityCaptureMock(),
) {
  const configService = { get: jest.fn().mockReturnValue('a'.repeat(64)) };
  const dispatcher = { dispatchEscalation: jest.fn().mockResolvedValue(undefined) };
  return new WhatsAppBotService(
    prisma as never,
    meta as never,
    configService as never,
    dispatcher as never,
    identityCapture as never,
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

function makeConversation(
  overrides: Partial<{
    consecutiveFaqMisses: number;
    status: WhatsAppConversationStatus;
    unregisteredContactId: string | null;
    residentId: string | null;
  }> = {},
) {
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
  conversationOverrides: Partial<{
    consecutiveFaqMisses: number;
    status: WhatsAppConversationStatus;
    unregisteredContactId: string | null;
    residentId: string | null;
  }> = {},
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

// ─── Bot Pipeline — Identity Capture (Phase 3) ────────────────────────────────

describe('WhatsAppBotService.processBotPipeline — identity capture', () => {
  it('sends the identity-capture prompt once after a FAQ answer', async () => {
    const faq = makeFaq(['cuota']);
    const prisma = makePrismaMock([faq]);
    prisma.whatsAppUnregisteredContact.findUnique.mockResolvedValue({
      id: 'contact-1',
      capturedUnitNumber: null,
      identityPromptSentAt: null,
    });
    const meta = makeMetaMock();
    const svc = makeBotService(prisma, meta);
    const ctx = makeCtx(
      { unregisteredContactId: 'contact-1' },
      { identityCaptureEnabled: true, identityCapturePrompt: 'Comparte tu casa y nombre' },
      'pregunta sobre la cuota',
    );

    await svc.processBotPipeline(ctx);

    expect(meta.sendTextMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'Comparte tu casa y nombre',
    );
    expect(prisma.whatsAppUnregisteredContact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { identityPromptSentAt: expect.any(Date) } }),
    );
  });

  it('does not re-send the prompt when it was already sent', async () => {
    const faq = makeFaq(['cuota']);
    const prisma = makePrismaMock([faq]);
    prisma.whatsAppUnregisteredContact.findUnique.mockResolvedValue({
      id: 'contact-1',
      capturedUnitNumber: null,
      identityPromptSentAt: new Date(),
    });
    const meta = makeMetaMock();
    const svc = makeBotService(prisma, meta);
    const ctx = makeCtx(
      { unregisteredContactId: 'contact-1' },
      { identityCaptureEnabled: true, identityCapturePrompt: 'Comparte tu casa' },
      'pregunta sobre la cuota',
    );

    await svc.processBotPipeline(ctx);

    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      faq.answer,
    );
  });

  it('auto-links and sends a confirmation when identity capture matches', async () => {
    const faq = makeFaq(['cuota']);
    const prisma = makePrismaMock([faq]);
    prisma.whatsAppConversation.findUnique.mockResolvedValue(
      makeConversation({ residentId: 'resident-1', unregisteredContactId: null }),
    );
    const meta = makeMetaMock();
    const identityCapture = makeIdentityCaptureMock();
    identityCapture.tryCaptureIdentity.mockResolvedValue({ matchedResidentId: 'resident-1' });
    const svc = makeBotService(prisma, meta, identityCapture);
    const ctx = makeCtx(
      { unregisteredContactId: 'contact-1' },
      { identityCaptureEnabled: true },
      'casa 47, Juan Pérez',
    );

    await svc.processBotPipeline(ctx);

    expect(identityCapture.tryCaptureIdentity).toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.stringContaining('identifiqué'),
    );
  });
});

// ─── Webhook Media Extraction (Phase 3) ───────────────────────────────────────

describe('extractMediaMeta', () => {
  it('extracts image metadata including caption', () => {
    const msg = {
      image: { id: 'media-1', mime_type: 'image/jpeg', sha256: 'abc', caption: 'el bote roto' },
    };
    expect(extractMediaMeta(msg, 'image')).toEqual({
      mediaMetaId: 'media-1',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      mediaCaption: 'el bote roto',
      mediaSizeBytes: null,
    });
  });

  it('extracts a document filename', () => {
    const msg = {
      document: { id: 'doc-1', mime_type: 'application/pdf', filename: 'recibo.pdf' },
    };
    expect(extractMediaMeta(msg, 'document')).toEqual(
      expect.objectContaining({ mediaMetaId: 'doc-1', mediaFilename: 'recibo.pdf' }),
    );
  });

  it('returns all-null fields for a text message', () => {
    expect(extractMediaMeta({ text: { body: 'hola' } }, 'text')).toEqual({
      mediaMetaId: null,
      mediaMimeType: null,
      mediaFilename: null,
      mediaCaption: null,
      mediaSizeBytes: null,
    });
  });
});

// ─── WhatsAppService — Webhook & Outbound Media (Phase 3) ─────────────────────

function makeWhatsAppService(prisma: Record<string, unknown>) {
  const configService = { get: jest.fn().mockReturnValue('a'.repeat(64)) };
  const auditService = { log: jest.fn().mockResolvedValue({}) };
  const metaClient = {
    sendTextMessage: jest.fn().mockResolvedValue({ messageId: 'wamid.out' }),
    uploadMedia: jest.fn().mockResolvedValue({ mediaId: 'meta-media-1' }),
    sendImageMessage: jest.fn().mockResolvedValue({ messageId: 'wamid.img' }),
    sendDocumentMessage: jest.fn().mockResolvedValue({ messageId: 'wamid.doc' }),
  };
  const botService = { processBotPipeline: jest.fn().mockResolvedValue(undefined) };
  const service = new WhatsAppService(
    prisma as never,
    configService as never,
    auditService as never,
    metaClient as never,
    botService as never,
  );
  return { service, prisma, auditService, metaClient, botService };
}

describe('WhatsAppService.processWebhookPayload — unknown phone & media', () => {
  function makeWebhookPrisma(
    conversationOverrides: Record<string, unknown> = {},
  ) {
    return {
      condominium: { findUnique: jest.fn().mockResolvedValue({ id: 'condo-1' }) },
      whatsAppCredential: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cred-1',
          status: 'ACTIVE',
          phoneNumberId: 'pn',
          accessTokenCiphertext: 'c',
          accessTokenIv: 'i',
          accessTokenAuthTag: 't',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsAppMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      },
      whatsAppNotificationPreference: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      whatsAppConversation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'conv-1',
          status: 'BOT_ACTIVE',
          condominiumId: 'condo-1',
          phoneNumber: '+528111111111',
          unregisteredContactId: 'contact-1',
          ...conversationOverrides,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      resident: { findFirst: jest.fn().mockResolvedValue(null) },
      whatsAppUnregisteredContact: {
        upsert: jest.fn().mockResolvedValue({ id: 'contact-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsAppBotConfig: {
        upsert: jest.fn().mockResolvedValue({ id: 'bc-1', isEnabled: true }),
      },
    };
  }

  it('upserts an unregistered contact and bumps message counters', async () => {
    const prisma = makeWebhookPrisma();
    const { service } = makeWhatsAppService(prisma);

    await service.processWebhookPayload('condo-slug', {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'wamid.1', from: '528111111111', type: 'text', text: { body: 'hola' } },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(prisma.whatsAppUnregisteredContact.upsert).toHaveBeenCalled();
    expect(prisma.whatsAppUnregisteredContact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ messageCount: { increment: 1 } }),
      }),
    );
  });

  it('stores only media metadata for an inbound image', async () => {
    const prisma = makeWebhookPrisma();
    const { service } = makeWhatsAppService(prisma);

    await service.processWebhookPayload('condo-slug', {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.2',
                    from: '528111111111',
                    type: 'image',
                    image: { id: 'media-xyz', mime_type: 'image/jpeg', caption: 'el bote roto' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(prisma.whatsAppMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageType: 'IMAGE',
          mediaMetaId: 'media-xyz',
          mediaMimeType: 'image/jpeg',
          mediaCaption: 'el bote roto',
        }),
      }),
    );
  });
});

describe('WhatsAppService.sendMessage — outbound media', () => {
  function makeOutboundPrisma(convStatus = 'ADMIN_HANDLING') {
    const enc = encrypt('token', 'a'.repeat(64));
    return {
      whatsAppConversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conv-1',
          condominiumId: 'condo-1',
          phoneNumber: '+528113333333',
          status: convStatus,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsAppCredential: {
        findUnique: jest.fn().mockResolvedValue({
          phoneNumberId: 'pn',
          accessTokenCiphertext: enc.ciphertext,
          accessTokenIv: enc.iv,
          accessTokenAuthTag: enc.authTag,
        }),
      },
      whatsAppMessage: { create: jest.fn().mockResolvedValue({ id: 'msg-out-1' }) },
    };
  }

  it('uploads to Meta then sends an outbound image with caption', async () => {
    const prisma = makeOutboundPrisma();
    const { service, metaClient } = makeWhatsAppService(prisma);

    await service.sendMessage(
      'condo-1',
      'conv-1',
      {
        type: 'IMAGE',
        mediaBase64: Buffer.from('fake-image-bytes').toString('base64'),
        mediaMimeType: 'image/jpeg',
        mediaCaption: 'hola',
      } as never,
      { sub: 'user-1' } as never,
    );

    expect(metaClient.uploadMedia).toHaveBeenCalled();
    expect(metaClient.sendImageMessage).toHaveBeenCalledWith(
      'pn',
      expect.any(String),
      '+528113333333',
      'meta-media-1',
      'hola',
    );
    expect(prisma.whatsAppMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageType: 'IMAGE',
          mediaMetaId: 'meta-media-1',
          mediaCaption: 'hola',
        }),
      }),
    );
  });

  it('rejects an image larger than the 5MB limit', async () => {
    const prisma = makeOutboundPrisma();
    const { service } = makeWhatsAppService(prisma);
    const oversized = Buffer.alloc(6 * 1024 * 1024).toString('base64');

    await expect(
      service.sendMessage(
        'condo-1',
        'conv-1',
        { type: 'IMAGE', mediaBase64: oversized, mediaMimeType: 'image/jpeg' } as never,
        { sub: 'user-1' } as never,
      ),
    ).rejects.toThrow();
  });
});
