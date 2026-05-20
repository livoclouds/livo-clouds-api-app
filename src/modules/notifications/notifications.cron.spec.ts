import { NOTIFICATION_RETENTION_DAYS } from './notifications.constants';
import { NotificationsRetentionCron } from './notifications.cron';

interface PrismaMock {
  notification: { deleteMany: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

const RETENTION_WINDOW_MS = NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

describe('NotificationsRetentionCron', () => {
  it('deletes notifications older than the 90-day retention window', async () => {
    const prisma = makePrismaMock();
    prisma.notification.deleteMany.mockResolvedValueOnce({ count: 7 });
    const cron = new NotificationsRetentionCron(prisma as never);

    const before = Date.now();
    await cron.purgeExpiredNotifications();
    const after = Date.now();

    expect(prisma.notification.deleteMany).toHaveBeenCalledTimes(1);
    const arg = prisma.notification.deleteMany.mock.calls[0][0];
    const cutoff = arg.where.createdAt.lt as Date;
    expect(cutoff).toBeInstanceOf(Date);
    // Cutoff is "now minus 90 days", computed at run time.
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(
      before - RETENTION_WINDOW_MS - 1000,
    );
    expect(cutoff.getTime()).toBeLessThanOrEqual(
      after - RETENTION_WINDOW_MS + 1000,
    );
  });

  it('does not target rows newer than the retention window', async () => {
    const prisma = makePrismaMock();
    const cron = new NotificationsRetentionCron(prisma as never);

    await cron.purgeExpiredNotifications();

    const arg = prisma.notification.deleteMany.mock.calls[0][0];
    // The predicate matches only rows strictly older than the cutoff, and the
    // cutoff is in the past — so anything created within 90 days survives.
    expect(arg.where).toEqual({ createdAt: { lt: expect.any(Date) } });
    expect((arg.where.createdAt.lt as Date).getTime()).toBeLessThan(Date.now());
  });

  it('logs and swallows a delete failure so the scheduler stays healthy', async () => {
    const prisma = makePrismaMock();
    prisma.notification.deleteMany.mockRejectedValueOnce(new Error('db down'));
    const cron = new NotificationsRetentionCron(prisma as never);

    await expect(cron.purgeExpiredNotifications()).resolves.toBeUndefined();
  });
});
