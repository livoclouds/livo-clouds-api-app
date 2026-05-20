import { WhatsAppConversationStatus } from '@prisma/client';
import { WhatsAppAnalyticsService } from './whatsapp-analytics.service';

function makeService(opts: {
  faqs?: { id: string; triggers: string[]; category: string | null; usageCount: number }[];
  medianSeconds?: number | null;
  resolvedCount?: number;
} = {}) {
  const count = jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
    const where = args.where;
    if (where.escalatedAt) return Promise.resolve(4);
    if (where.status === WhatsAppConversationStatus.ESCALATED) return Promise.resolve(2);
    if (where.unreadCountForAdmin) return Promise.resolve(3);
    const createdAt = where.createdAt as { gte?: Date; lt?: Date } | undefined;
    if (createdAt && createdAt.lt) return Promise.resolve(10);
    if (createdAt) return Promise.resolve(1);
    return Promise.resolve(0);
  });

  const queryRaw = jest
    .fn()
    .mockResolvedValueOnce([{ bucket: new Date('2026-05-01T00:00:00.000Z'), count: 7 }])
    .mockResolvedValueOnce([
      {
        median_seconds: opts.medianSeconds === undefined ? 7200 : opts.medianSeconds,
        resolved_count: opts.resolvedCount ?? 5,
      },
    ]);

  const prisma = {
    whatsAppConversation: {
      count,
      findFirst: jest.fn().mockResolvedValue({
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      }),
    },
    whatsAppFaq: {
      findMany: jest.fn().mockResolvedValue(
        opts.faqs ?? [
          { id: 'f1', triggers: ['horario'], category: 'general', usageCount: 9 },
        ],
      ),
    },
    $queryRaw: queryRaw,
  };

  const service = new WhatsAppAnalyticsService(prisma as never);
  return { service, prisma, count };
}

describe('WhatsAppAnalyticsService.getSummary', () => {
  it('returns the full analytics shape', async () => {
    const { service } = makeService();
    const result = await service.getSummary('condo-1', {});
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('conversationsOverTime');
    expect(result).toHaveProperty('escalation');
    expect(result).toHaveProperty('topFaqs');
    expect(result).toHaveProperty('resolution');
    expect(result).toHaveProperty('unreadAging');
    expect(result.range.granularity).toBe('day');
  });

  it('computes escalation rate as a percentage of conversations in range', async () => {
    const { service } = makeService();
    const result = await service.getSummary('condo-1', {});
    // total = 10, escalated = 4 → 40%
    expect(result.escalation.totalConversations).toBe(10);
    expect(result.escalation.escalatedConversations).toBe(4);
    expect(result.escalation.escalationRate).toBe(40);
  });

  it('scopes every conversation query to the requested condominium', async () => {
    const { service, count } = makeService();
    await service.getSummary('condo-xyz', {});
    for (const call of count.mock.calls) {
      expect(call[0].where.condominiumId).toBe('condo-xyz');
    }
  });

  it('maps top FAQs to aggregate fields only — no message content', async () => {
    const { service } = makeService({
      faqs: [{ id: 'f1', triggers: ['horario', 'hora'], category: 'general', usageCount: 9 }],
    });
    const result = await service.getSummary('condo-1', {});
    expect(result.topFaqs[0]).toEqual({
      id: 'f1',
      label: 'horario',
      category: 'general',
      usageCount: 9,
    });
  });

  it('converts the median resolution time from seconds to hours', async () => {
    const { service } = makeService({ medianSeconds: 7200, resolvedCount: 6 });
    const result = await service.getSummary('condo-1', {});
    expect(result.resolution.medianHoursToResolution).toBe(2);
    expect(result.resolution.resolvedCount).toBe(6);
  });

  it('returns a null median when no conversations were resolved in range', async () => {
    const { service } = makeService({ medianSeconds: null, resolvedCount: 0 });
    const result = await service.getSummary('condo-1', {});
    expect(result.resolution.medianHoursToResolution).toBeNull();
  });

  it('clamps an oversized custom range without throwing', async () => {
    const { service } = makeService();
    const result = await service.getSummary('condo-1', {
      from: '2000-01-01T00:00:00.000Z',
      to: '2030-01-01T00:00:00.000Z',
    });
    const spanMs =
      new Date(result.range.to).getTime() - new Date(result.range.from).getTime();
    expect(spanMs).toBeLessThanOrEqual(367 * 24 * 60 * 60 * 1000);
  });
});
