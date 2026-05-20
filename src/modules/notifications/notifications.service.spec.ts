import { NotFoundException } from '@nestjs/common';
import { NotificationType, RootScope } from '@prisma/client';
import { NotificationsService, NotificationEventInput } from './notifications.service';
import { NOTIFICATION_R1_TYPES } from './notifications.constants';

const USER_ID = 'user-1';
const CONDOMINIUM_ID = 'cond-1';

interface PrismaMock {
  notification: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
  };
  userNotificationPreference: {
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
  rootNotificationScope: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue(null),
    },
    userNotificationPreference: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(null),
    },
    rootNotificationScope: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaMock) => Promise<unknown>)(mock);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return undefined;
  });
  return mock;
}

function makeService(prisma: PrismaMock): NotificationsService {
  return new NotificationsService(prisma as never);
}

function eventInput(
  overrides: Partial<NotificationEventInput> = {},
): NotificationEventInput {
  return {
    userId: USER_ID,
    condominiumId: CONDOMINIUM_ID,
    type: NotificationType.IMPORT_COMPLETED,
    title: 'Import completed',
    message: 'Your import finished',
    data: { batchId: 'batch-1' },
    linkUrl: '/dashboard/imports/batch-1',
    ...overrides,
  };
}

describe('NotificationsService.tryAggregate', () => {
  it('updates an open aggregate row when aggregateUntil is greater than now', async () => {
    const prisma = makePrismaMock();
    const openRow = {
      id: 'notif-open',
      aggregateCount: 1,
      readAt: null,
      dismissedAt: null,
    };
    prisma.notification.findFirst.mockResolvedValueOnce(openRow);
    prisma.notification.update.mockResolvedValueOnce({
      ...openRow,
      aggregateCount: 2,
    });
    const service = makeService(prisma);

    const result = await service.tryAggregate(eventInput());

    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-open' },
        data: expect.objectContaining({
          aggregateCount: { increment: 1 },
          aggregateUntil: expect.any(Date),
        }),
      }),
    );
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ aggregateCount: 2 }));
  });

  it('inserts a new row when no open aggregate row exists', async () => {
    const prisma = makePrismaMock();
    prisma.notification.findFirst.mockResolvedValueOnce(null);
    prisma.notification.create.mockResolvedValueOnce({
      id: 'notif-new',
      aggregateCount: 1,
    });
    const service = makeService(prisma);

    const result = await service.tryAggregate(eventInput());

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          type: NotificationType.IMPORT_COMPLETED,
          aggregateCount: 1,
          aggregateUntil: expect.any(Date),
        }),
      }),
    );
    expect(prisma.notification.update).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 'notif-new' }));
  });

  it('does not aggregate into a row where readAt is not null', async () => {
    const prisma = makePrismaMock();
    // A read row is excluded by the candidate query, so findFirst returns null.
    prisma.notification.findFirst.mockResolvedValueOnce(null);
    prisma.notification.create.mockResolvedValueOnce({ id: 'notif-new' });
    const service = makeService(prisma);

    await service.tryAggregate(eventInput());

    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ readAt: null }),
      }),
    );
    expect(prisma.notification.create).toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('does not aggregate into a row where dismissedAt is not null', async () => {
    const prisma = makePrismaMock();
    prisma.notification.findFirst.mockResolvedValueOnce(null);
    prisma.notification.create.mockResolvedValueOnce({ id: 'notif-new' });
    const service = makeService(prisma);

    await service.tryAggregate(eventInput());

    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dismissedAt: null }),
      }),
    );
    expect(prisma.notification.create).toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.createForEvent', () => {
  it('writes a notification row and returns the created row', async () => {
    const prisma = makePrismaMock();
    const created = { id: 'notif-created', aggregateCount: 1 };
    prisma.notification.findFirst.mockResolvedValueOnce(null);
    prisma.notification.create.mockResolvedValueOnce(created);
    const service = makeService(prisma);

    const result = await service.createForEvent(eventInput());

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual(created);
  });

  it('returns the aggregated row when an open row exists', async () => {
    const prisma = makePrismaMock();
    const aggregated = { id: 'notif-open', aggregateCount: 3 };
    prisma.notification.findFirst.mockResolvedValueOnce({
      id: 'notif-open',
      readAt: null,
      dismissedAt: null,
    });
    prisma.notification.update.mockResolvedValueOnce(aggregated);
    const service = makeService(prisma);

    const result = await service.createForEvent(eventInput());

    expect(result).toEqual(aggregated);
  });
});

describe('NotificationsService.markRead', () => {
  it('updates readAt and isRead for an owned notification', async () => {
    const prisma = makePrismaMock();
    prisma.notification.findFirst.mockResolvedValueOnce({
      id: 'notif-1',
      userId: USER_ID,
      readAt: null,
      dismissedAt: null,
    });
    prisma.notification.update.mockResolvedValueOnce({
      id: 'notif-1',
      readAt: new Date(),
      isRead: true,
    });
    const service = makeService(prisma);

    const result = await service.markRead(CONDOMINIUM_ID, 'notif-1', USER_ID);

    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: expect.objectContaining({
          readAt: expect.any(Date),
          isRead: true,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: 'notif-1', isRead: true }),
    );
  });

  it('rejects marking another user notification as read', async () => {
    const prisma = makePrismaMock();
    prisma.notification.findFirst.mockResolvedValueOnce({
      id: 'notif-1',
      userId: 'someone-else',
      readAt: null,
      dismissedAt: null,
    });
    const service = makeService(prisma);

    await expect(
      service.markRead(CONDOMINIUM_ID, 'notif-1', USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.dismiss', () => {
  it('updates dismissedAt for an owned notification', async () => {
    const prisma = makePrismaMock();
    prisma.notification.findFirst.mockResolvedValueOnce({
      id: 'notif-1',
      userId: USER_ID,
      readAt: null,
      dismissedAt: null,
    });
    prisma.notification.update.mockResolvedValueOnce({
      id: 'notif-1',
      dismissedAt: new Date(),
    });
    const service = makeService(prisma);

    const result = await service.dismiss(CONDOMINIUM_ID, 'notif-1', USER_ID);

    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: { dismissedAt: expect.any(Date) },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ dismissedAt: expect.any(Date) }),
    );
  });
});

describe('NotificationsService.getPreferences', () => {
  it('returns missing preferences as enabled by default', async () => {
    const prisma = makePrismaMock();
    prisma.userNotificationPreference.findMany.mockResolvedValueOnce([]);
    const service = makeService(prisma);

    const { preferences } = await service.getPreferences(USER_ID);

    for (const type of NOTIFICATION_R1_TYPES) {
      expect(preferences[type]).toBe(true);
    }
  });

  it('reflects a stored disabled override', async () => {
    const prisma = makePrismaMock();
    prisma.userNotificationPreference.findMany.mockResolvedValueOnce([
      { type: NotificationType.IMPORT_WITH_WARNINGS, enabled: false },
    ]);
    const service = makeService(prisma);

    const { preferences } = await service.getPreferences(USER_ID);

    expect(preferences[NotificationType.IMPORT_WITH_WARNINGS]).toBe(false);
    expect(preferences[NotificationType.IMPORT_COMPLETED]).toBe(true);
  });
});

describe('NotificationsService.getRootScope', () => {
  it('defaults to ACTIVE_TENANT when no row exists', async () => {
    const prisma = makePrismaMock();
    prisma.rootNotificationScope.findUnique.mockResolvedValueOnce(null);
    const service = makeService(prisma);

    const result = await service.getRootScope(USER_ID);

    expect(result).toEqual({
      scope: RootScope.ACTIVE_TENANT,
      condominiumIds: [],
    });
  });
});
