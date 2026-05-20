import { encrypt } from '../../common/utils/encryption.util';
import {
  getNextBusinessWindow,
  isWithinBusinessHours,
  parseBusinessHours,
  renderOffHoursMessage,
} from './business-hours.util';
import { WhatsAppBotService } from './whatsapp-bot.service';

const TZ = 'America/Monterrey'; // fixed UTC-6 (Mexico abolished DST in 2022)
const HOURS = 'Mon–Fri 09:00–18:00';

// Reference instants (verified weekdays):
//   2026-05-20 is a Wednesday.
const WED_WITHIN = new Date('2026-05-20T20:00:00Z'); // 14:00 Wed local — within
const WED_AFTER = new Date('2026-05-21T02:00:00Z'); // 20:00 Wed local — after
const WED_BEFORE = new Date('2026-05-20T13:00:00Z'); // 07:00 Wed local — before
const SAT_OFF = new Date('2026-05-23T18:00:00Z'); // 12:00 Sat local — weekend

describe('parseBusinessHours', () => {
  it('parses a day range with times', () => {
    const parsed = parseBusinessHours(HOURS);
    expect(parsed).not.toBeNull();
    expect([...(parsed?.daysSet ?? [])].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(parsed?.startMinutes).toBe(9 * 60);
    expect(parsed?.endMinutes).toBe(18 * 60);
  });

  it('parses a comma-separated day list', () => {
    const parsed = parseBusinessHours('Mon, Wed, Fri 08:00-14:00');
    expect([...(parsed?.daysSet ?? [])].sort()).toEqual([0, 2, 4]);
  });

  it('returns null for empty / unparseable / non-string input', () => {
    expect(parseBusinessHours('')).toBeNull();
    expect(parseBusinessHours('{}')).toBeNull();
    expect(parseBusinessHours({})).toBeNull();
    expect(parseBusinessHours(null)).toBeNull();
    expect(parseBusinessHours('Mon–Fri')).toBeNull();
  });

  it('returns null when start is not before end', () => {
    expect(parseBusinessHours('Mon–Fri 18:00–09:00')).toBeNull();
  });
});

describe('isWithinBusinessHours', () => {
  it('is true within the configured window on a weekday', () => {
    expect(isWithinBusinessHours(WED_WITHIN, HOURS, TZ)).toBe(true);
  });

  it('is false before opening', () => {
    expect(isWithinBusinessHours(WED_BEFORE, HOURS, TZ)).toBe(false);
  });

  it('is false after closing', () => {
    expect(isWithinBusinessHours(WED_AFTER, HOURS, TZ)).toBe(false);
  });

  it('is false on a non-business day (weekend)', () => {
    expect(isWithinBusinessHours(SAT_OFF, HOURS, TZ)).toBe(false);
  });

  it('treats missing / unparseable business hours as always open', () => {
    expect(isWithinBusinessHours(SAT_OFF, '{}', TZ)).toBe(true);
    expect(isWithinBusinessHours(SAT_OFF, '', TZ)).toBe(true);
  });

  it('respects the condominium timezone', () => {
    // Same instant as WED_WITHIN, but in UTC it is 20:00 — outside the window.
    expect(isWithinBusinessHours(WED_WITHIN, HOURS, 'UTC')).toBe(false);
  });
});

describe('getNextBusinessWindow', () => {
  it('returns the next opening at the configured start time', () => {
    const window = getNextBusinessWindow(WED_AFTER, HOURS, TZ);
    expect(window?.nextTime).toBe('09:00');
    expect(window?.nextDay).toBeTruthy();
  });

  it('skips the weekend to the following Monday', () => {
    const window = getNextBusinessWindow(SAT_OFF, HOURS, TZ, 'en-US');
    expect(window?.nextDay).toBe('Monday');
    expect(window?.nextTime).toBe('09:00');
  });

  it('skips Friday-after-hours to Monday', () => {
    // FRI_AFTER constructed so the local time is Friday after 18:00.
    const friday = new Date('2026-05-23T01:00:00Z'); // 19:00 Fri local
    const window = getNextBusinessWindow(friday, HOURS, TZ, 'en-US');
    expect(window?.nextDay).toBe('Monday');
  });

  it('returns null for missing business hours', () => {
    expect(getNextBusinessWindow(WED_AFTER, '{}', TZ)).toBeNull();
  });
});

describe('renderOffHoursMessage', () => {
  it('replaces the {{nextDay}} and {{nextTime}} placeholders', () => {
    const out = renderOffHoursMessage(
      'Volvemos {{nextDay}} a las {{nextTime}}.',
      { nextDay: 'Jueves', nextTime: '09:00' },
    );
    expect(out).toBe('Volvemos Jueves a las 09:00.');
    expect(out).not.toContain('{{');
  });
});

// ─── Bot pipeline — off-hours postfix ─────────────────────────────────────────

function makeFaq(triggers: string[], answer = 'Respuesta FAQ') {
  return {
    id: 'faq-1',
    condominiumId: 'condo-1',
    category: null,
    triggers,
    answer,
    sortOrder: 0,
    isActive: true,
    usageCount: 0,
    lastUsedAt: null,
    createdByUserId: 'u',
    updatedByUserId: 'u',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makePrisma(settings: unknown) {
  return {
    whatsAppFaq: {
      findMany: jest.fn().mockResolvedValue([makeFaq(['cuota'])]),
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
    condominiumSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
  };
}

function makeBotService(prisma: ReturnType<typeof makePrisma>) {
  const meta = { sendTextMessage: jest.fn().mockResolvedValue({ messageId: 'wamid.x' }) };
  const config = { get: jest.fn().mockReturnValue('a'.repeat(64)) };
  const dispatcher = { dispatchEscalation: jest.fn().mockResolvedValue(undefined) };
  const identityCapture = {
    tryCaptureIdentity: jest.fn().mockResolvedValue({ matchedResidentId: null }),
  };
  const svc = new WhatsAppBotService(
    prisma as never,
    meta as never,
    config as never,
    dispatcher as never,
    identityCapture as never,
  );
  return { svc, meta };
}

function makeCtx() {
  const { ciphertext, iv, authTag } = encrypt('token', 'a'.repeat(64));
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
    inboundMessage: { id: 'in-1', textContent: 'pregunta sobre la cuota' },
    botConfig: {
      id: 'bc-1',
      isEnabled: true,
      whitelistEnabled: false,
      whitelistedPhoneNumbers: [],
      escalationKeywords: ['humano'],
      escalationMessage: 'Escalando',
      fallbackMessage: 'No encontré',
      identityCaptureEnabled: false,
      offHoursMessage: 'Estamos cerrados. Volvemos {{nextDay}} a las {{nextTime}}.',
    },
    phoneNumberId: 'pn-1',
    accessTokenCiphertext: ciphertext,
    accessTokenIv: iv,
    accessTokenAuthTag: authTag,
  };
}

describe('WhatsAppBotService.processBotPipeline — off-hours postfix', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('appends the off-hours postfix when handled outside business hours', async () => {
    jest.setSystemTime(WED_AFTER);
    const prisma = makePrisma({ businessHours: HOURS, timezone: TZ });
    const { svc, meta } = makeBotService(prisma);

    await svc.processBotPipeline(makeCtx() as never);

    const sent = meta.sendTextMessage.mock.calls[0][3] as string;
    expect(sent).toContain('Respuesta FAQ');
    expect(sent).toContain('Estamos cerrados.');
    expect(sent).toContain('09:00');
    expect(sent).not.toContain('{{');
  });

  it('does NOT append the postfix within business hours', async () => {
    jest.setSystemTime(WED_WITHIN);
    const prisma = makePrisma({ businessHours: HOURS, timezone: TZ });
    const { svc, meta } = makeBotService(prisma);

    await svc.processBotPipeline(makeCtx() as never);

    expect(meta.sendTextMessage.mock.calls[0][3]).toBe('Respuesta FAQ');
  });

  it('does NOT append the postfix when business hours are not configured', async () => {
    jest.setSystemTime(WED_AFTER);
    const prisma = makePrisma({ businessHours: {}, timezone: TZ });
    const { svc, meta } = makeBotService(prisma);

    await svc.processBotPipeline(makeCtx() as never);

    expect(meta.sendTextMessage.mock.calls[0][3]).toBe('Respuesta FAQ');
  });
});
