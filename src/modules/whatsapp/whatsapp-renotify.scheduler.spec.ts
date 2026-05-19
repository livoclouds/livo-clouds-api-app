import { WhatsAppConversationStatus } from '@prisma/client';
import { WhatsAppRenotifyScheduler } from './whatsapp-renotify.scheduler';

function setup(opts: {
  candidates: Array<{ id: string; condominiumId: string; firstNotifiedAt: Date | null }>;
  botConfigs?: Array<{ condominiumId: string; reNotifyAfterMinutes: number }>;
  overrides?: Array<{ condominiumId: string; reNotifyAfterMinutes: number | null }>;
}) {
  const prisma = {
    whatsAppConversation: {
      findMany: jest.fn().mockResolvedValue(opts.candidates),
    },
    whatsAppBotConfig: {
      findMany: jest
        .fn()
        .mockResolvedValue(opts.botConfigs ?? [{ condominiumId: 'condo-1', reNotifyAfterMinutes: 5 }]),
    },
    whatsAppNotificationPreference: {
      findMany: jest.fn().mockResolvedValue(opts.overrides ?? []),
    },
  };
  const dispatcher = { dispatchReNotification: jest.fn().mockResolvedValue(undefined) };
  const scheduler = new WhatsAppRenotifyScheduler(prisma as never, dispatcher as never);
  return { scheduler, prisma, dispatcher };
}

describe('WhatsAppRenotifyScheduler.scanAndReNotify', () => {
  it('dispatches when elapsed time exceeds threshold', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const { scheduler, dispatcher } = setup({
      candidates: [{ id: 'conv-1', condominiumId: 'condo-1', firstNotifiedAt: tenMinAgo }],
    });
    await scheduler.scanAndReNotify();
    expect(dispatcher.dispatchReNotification).toHaveBeenCalledWith('conv-1');
  });

  it('skips when elapsed time is below threshold', async () => {
    const oneMinAgo = new Date(Date.now() - 60_000);
    const { scheduler, dispatcher } = setup({
      candidates: [{ id: 'conv-1', condominiumId: 'condo-1', firstNotifiedAt: oneMinAgo }],
    });
    await scheduler.scanAndReNotify();
    expect(dispatcher.dispatchReNotification).not.toHaveBeenCalled();
  });

  it('respects per-preference reNotifyAfterMinutes override (shorter wins)', async () => {
    const threeMinAgo = new Date(Date.now() - 3 * 60_000);
    const { scheduler, dispatcher } = setup({
      candidates: [{ id: 'conv-1', condominiumId: 'condo-1', firstNotifiedAt: threeMinAgo }],
      botConfigs: [{ condominiumId: 'condo-1', reNotifyAfterMinutes: 10 }],
      overrides: [{ condominiumId: 'condo-1', reNotifyAfterMinutes: 2 }],
    });
    await scheduler.scanAndReNotify();
    expect(dispatcher.dispatchReNotification).toHaveBeenCalledWith('conv-1');
  });

  it('queries only ESCALATED conversations with firstNotifiedAt not null and reNotifiedAt null', async () => {
    const { scheduler, prisma } = setup({ candidates: [] });
    await scheduler.scanAndReNotify();
    expect(prisma.whatsAppConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: WhatsAppConversationStatus.ESCALATED,
          firstNotifiedAt: { not: null },
          reNotifiedAt: null,
        }),
      }),
    );
  });

  it('catches per-conversation dispatcher failures without throwing', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const { scheduler, dispatcher } = setup({
      candidates: [
        { id: 'conv-1', condominiumId: 'condo-1', firstNotifiedAt: tenMinAgo },
        { id: 'conv-2', condominiumId: 'condo-1', firstNotifiedAt: tenMinAgo },
      ],
    });
    dispatcher.dispatchReNotification.mockRejectedValueOnce(new Error('boom'));
    await expect(scheduler.scanAndReNotify()).resolves.toBeUndefined();
    expect(dispatcher.dispatchReNotification).toHaveBeenCalledTimes(2);
  });
});
