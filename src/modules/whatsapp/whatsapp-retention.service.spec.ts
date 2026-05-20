import { WhatsAppConversationStatus } from '@prisma/client';
import { WhatsAppRetentionService } from './whatsapp-retention.service';

function makeService(opts: {
  configs?: { condominiumId: string; conversationRetentionDays: number }[];
  staleByCondo?: Record<string, { id: string }[]>;
  deleteCount?: (ids: string[]) => number;
}) {
  const findManyConv = jest.fn().mockImplementation(({ where }) =>
    Promise.resolve(opts.staleByCondo?.[where.condominiumId as string] ?? []),
  );
  const deleteMany = jest.fn().mockImplementation(({ where }) => {
    const ids = where.conversationId.in as string[];
    const count = opts.deleteCount ? opts.deleteCount(ids) : ids.length * 2;
    return Promise.resolve({ count });
  });
  const prisma = {
    whatsAppBotConfig: { findMany: jest.fn().mockResolvedValue(opts.configs ?? []) },
    whatsAppConversation: { findMany: findManyConv },
    whatsAppMessage: { deleteMany },
  };
  const service = new WhatsAppRetentionService(prisma as never);
  return { service, prisma, findManyConv, deleteMany };
}

describe('WhatsAppRetentionService.sweep', () => {
  it('deletes messages of resolved conversations older than the retention window', async () => {
    const { service, deleteMany } = makeService({
      configs: [{ condominiumId: 'condo-1', conversationRetentionDays: 90 }],
      staleByCondo: { 'condo-1': [{ id: 'c1' }, { id: 'c2' }] },
    });
    const result = await service.sweep();
    expect(deleteMany).toHaveBeenCalledWith({
      where: { conversationId: { in: ['c1', 'c2'] } },
    });
    expect(result).toEqual({
      condominiumsScanned: 1,
      conversationsAffected: 2,
      messagesDeleted: 4,
    });
  });

  it('queries only RESOLVED conversations resolved before the per-condominium cutoff', async () => {
    const fixedNow = new Date('2026-05-19T00:00:00.000Z');
    const { service, findManyConv } = makeService({
      configs: [{ condominiumId: 'condo-1', conversationRetentionDays: 30 }],
      staleByCondo: { 'condo-1': [] },
    });
    await service.sweep(fixedNow);
    const where = findManyConv.mock.calls[0][0].where;
    expect(where.status).toBe(WhatsAppConversationStatus.RESOLVED);
    expect(where.resolvedAt.not).toBeNull();
    expect(where.resolvedAt.lt).toEqual(new Date('2026-04-19T00:00:00.000Z'));
  });

  it('skips condominiums whose retention is disabled (conversationRetentionDays = 0)', async () => {
    const { service, prisma } = makeService({ configs: [] });
    const result = await service.sweep();
    expect(prisma.whatsAppBotConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationRetentionDays: { gt: 0 } } }),
    );
    expect(result.messagesDeleted).toBe(0);
  });

  it('leaves active conversations untouched — only stale RESOLVED ids are passed to deleteMany', async () => {
    const { service, deleteMany } = makeService({
      configs: [{ condominiumId: 'condo-1', conversationRetentionDays: 90 }],
      staleByCondo: { 'condo-1': [{ id: 'resolved-old' }] },
    });
    await service.sweep();
    expect(deleteMany).toHaveBeenCalledWith({
      where: { conversationId: { in: ['resolved-old'] } },
    });
  });

  it('is idempotent — a re-run over already-swept conversations deletes nothing new', async () => {
    const { service } = makeService({
      configs: [{ condominiumId: 'condo-1', conversationRetentionDays: 90 }],
      staleByCondo: { 'condo-1': [{ id: 'c1' }] },
      deleteCount: () => 0,
    });
    const result = await service.sweep();
    expect(result.messagesDeleted).toBe(0);
    expect(result.conversationsAffected).toBe(1);
  });

  it('never deletes conversation rows (no deleteMany on whatsAppConversation)', async () => {
    const { service, prisma } = makeService({
      configs: [{ condominiumId: 'condo-1', conversationRetentionDays: 90 }],
      staleByCondo: { 'condo-1': [{ id: 'c1' }] },
    });
    await service.sweep();
    expect(
      (prisma.whatsAppConversation as Record<string, unknown>).deleteMany,
    ).toBeUndefined();
  });
});
