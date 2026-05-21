import { NotFoundException } from '@nestjs/common';
import { NotificationType, RootScope, UserRole } from '@prisma/client';
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
  user: {
    findMany: jest.Mock;
  };
  resident: {
    findFirst: jest.Mock;
  };
  userNotificationPreference: {
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
  rootNotificationScope: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
  condominium: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface GatewayMock {
  emitAfterWrite: jest.Mock;
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
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    resident: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    userNotificationPreference: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(null),
    },
    rootNotificationScope: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(null),
    },
    condominium: {
      findUnique: jest.fn().mockResolvedValue(null),
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

function makeGatewayMock(): GatewayMock {
  return { emitAfterWrite: jest.fn() };
}

function makeService(
  prisma: PrismaMock,
  gateway: GatewayMock = makeGatewayMock(),
): NotificationsService {
  return new NotificationsService(prisma as never, gateway as never);
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

    const { preferences } = await service.getPreferences(USER_ID, UserRole.ROOT);

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

    const { preferences } = await service.getPreferences(USER_ID, UserRole.ROOT);

    expect(preferences[NotificationType.IMPORT_WITH_WARNINGS]).toBe(false);
    expect(preferences[NotificationType.IMPORT_COMPLETED]).toBe(true);
  });

  it('surfaces only the types the caller role may receive (OQ-NT-12)', async () => {
    const prisma = makePrismaMock();
    prisma.userNotificationPreference.findMany.mockResolvedValueOnce([]);
    const service = makeService(prisma);

    const { preferences } = await service.getPreferences(
      USER_ID,
      UserRole.GUARD,
    );

    expect(Object.keys(preferences).sort()).toEqual([
      'PERMISSIONS_CHANGED',
      'SESSION_EXPIRING',
    ]);
  });
});

describe('NotificationsService.updatePreferences', () => {
  it('ignores keys the caller role may not receive', async () => {
    const prisma = makePrismaMock();
    prisma.userNotificationPreference.findMany.mockResolvedValueOnce([]);
    const service = makeService(prisma);

    // GUARD may not receive IMPORT_COMPLETED — that key must be dropped.
    await service.updatePreferences(USER_ID, UserRole.GUARD, {
      IMPORT_COMPLETED: false,
      PERMISSIONS_CHANGED: false,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const upserts = prisma.$transaction.mock.calls[0][0] as unknown[];
    expect(upserts).toHaveLength(1);
    expect(prisma.userNotificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: NotificationType.PERMISSIONS_CHANGED,
        }),
      }),
    );
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

describe('NotificationsService.tryAggregate gateway fan-out', () => {
  it('emits an SSE event with isAggregateUpdate=false after creating a row', async () => {
    const prisma = makePrismaMock();
    const gateway = makeGatewayMock();
    const created = { id: 'notif-new', userId: USER_ID, aggregateCount: 1 };
    prisma.notification.findFirst.mockResolvedValueOnce(null);
    prisma.notification.create.mockResolvedValueOnce(created);
    const service = makeService(prisma, gateway);

    await service.tryAggregate(eventInput());

    expect(gateway.emitAfterWrite).toHaveBeenCalledTimes(1);
    expect(gateway.emitAfterWrite).toHaveBeenCalledWith(created, false);
  });

  it('emits an SSE event with isAggregateUpdate=true after updating an open row', async () => {
    const prisma = makePrismaMock();
    const gateway = makeGatewayMock();
    const updated = { id: 'notif-open', userId: USER_ID, aggregateCount: 2 };
    prisma.notification.findFirst.mockResolvedValueOnce({
      id: 'notif-open',
      readAt: null,
      dismissedAt: null,
    });
    prisma.notification.update.mockResolvedValueOnce(updated);
    const service = makeService(prisma, gateway);

    await service.createForEvent(eventInput());

    expect(gateway.emitAfterWrite).toHaveBeenCalledWith(updated, true);
  });
});

describe('NotificationsService.getStreamSync', () => {
  it('returns the unread count and the most recent non-dismissed notifications', async () => {
    const prisma = makePrismaMock();
    const recent = [{ id: 'n1' }, { id: 'n2' }];
    prisma.notification.findMany.mockResolvedValueOnce(recent);
    prisma.notification.count.mockResolvedValueOnce(5);
    const service = makeService(prisma);

    const result = await service.getStreamSync(CONDOMINIUM_ID, USER_ID);

    expect(result).toEqual({ unreadCount: 5, recent });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: USER_ID,
          condominiumId: CONDOMINIUM_ID,
          dismissedAt: null,
        },
        take: 20,
      }),
    );
  });
});

describe('NotificationsService.list', () => {
  it('sorts by createdAt desc and applies no read filter by default', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    await service.list({
      userId: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      page: 1,
      limit: 20,
    });

    const args = prisma.notification.findMany.mock.calls[0][0] as {
      orderBy: unknown;
      where: { readAt?: unknown };
    };
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.where.readAt).toBeUndefined();
  });

  it('honors sortBy and sortDir', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    await service.list({
      userId: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      page: 1,
      limit: 20,
      sortBy: 'type',
      sortDir: 'asc',
    });

    const args = prisma.notification.findMany.mock.calls[0][0] as {
      orderBy: unknown;
    };
    expect(args.orderBy).toEqual({ type: 'asc' });
  });

  it('filters to read notifications when readOnly is set', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    await service.list({
      userId: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      page: 1,
      limit: 20,
      readOnly: true,
    });

    const args = prisma.notification.findMany.mock.calls[0][0] as {
      where: { readAt?: unknown };
    };
    expect(args.where.readAt).toEqual({ not: null });
  });

  it('lets unreadOnly take precedence over readOnly', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    await service.list({
      userId: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      page: 1,
      limit: 20,
      unreadOnly: true,
      readOnly: true,
    });

    const args = prisma.notification.findMany.mock.calls[0][0] as {
      where: { readAt?: unknown };
    };
    expect(args.where.readAt).toBeNull();
  });
});

describe('NotificationsService.resolveRecipientsForType', () => {
  it('returns an empty list for legacy notification types', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    const result = await service.resolveRecipientsForType(
      NotificationType.NEGATIVE_BALANCE,
      CONDOMINIUM_ID,
    );

    expect(result).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('queries users restricted to the roles allowed by the matrix', async () => {
    const prisma = makePrismaMock();
    prisma.user.findMany.mockResolvedValueOnce([]);
    const service = makeService(prisma);

    await service.resolveRecipientsForType(
      NotificationType.IMPORT_FAILED,
      CONDOMINIUM_ID,
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: [UserRole.ROOT, UserRole.TENANT_ADMIN] },
        }),
      }),
    );
  });

  it('removes a user with a disabled preference and keeps users with no row', async () => {
    const prisma = makePrismaMock();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'admin-1', role: UserRole.TENANT_ADMIN, email: 'a@x.com' },
      { id: 'admin-2', role: UserRole.TENANT_ADMIN, email: 'b@x.com' },
    ]);
    prisma.userNotificationPreference.findMany.mockResolvedValueOnce([
      { userId: 'admin-2' },
    ]);
    const service = makeService(prisma);

    const result = await service.resolveRecipientsForType(
      NotificationType.IMPORT_FAILED,
      CONDOMINIUM_ID,
    );

    expect(result).toEqual(['admin-1']);
  });

  it('applies ROOT scope: ALL keeps, SPECIFIC matches the condominium, ACTIVE_TENANT drops', async () => {
    const prisma = makePrismaMock();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'root-all', role: UserRole.ROOT, email: 'all@x.com' },
      { id: 'root-specific-hit', role: UserRole.ROOT, email: 'sh@x.com' },
      { id: 'root-specific-miss', role: UserRole.ROOT, email: 'sm@x.com' },
      { id: 'root-active', role: UserRole.ROOT, email: 'ac@x.com' },
      { id: 'root-default', role: UserRole.ROOT, email: 'df@x.com' },
    ]);
    prisma.rootNotificationScope.findMany.mockResolvedValueOnce([
      { userId: 'root-all', scope: RootScope.ALL, condominiumIds: [] },
      {
        userId: 'root-specific-hit',
        scope: RootScope.SPECIFIC,
        condominiumIds: [CONDOMINIUM_ID],
      },
      {
        userId: 'root-specific-miss',
        scope: RootScope.SPECIFIC,
        condominiumIds: ['other-cond'],
      },
      {
        userId: 'root-active',
        scope: RootScope.ACTIVE_TENANT,
        condominiumIds: [],
      },
      // root-default has no scope row → defaults to ACTIVE_TENANT (dropped).
    ]);
    const service = makeService(prisma);

    const result = await service.resolveRecipientsForType(
      NotificationType.IMPORT_FAILED,
      CONDOMINIUM_ID,
    );

    expect(result.sort()).toEqual(['root-all', 'root-specific-hit'].sort());
  });

  it('excludes the actor from the recipient set', async () => {
    const prisma = makePrismaMock();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'admin-1', role: UserRole.TENANT_ADMIN, email: 'a@x.com' },
      { id: 'actor', role: UserRole.TENANT_ADMIN, email: 'actor@x.com' },
    ]);
    const service = makeService(prisma);

    const result = await service.resolveRecipientsForType(
      NotificationType.IMPORT_FAILED,
      CONDOMINIUM_ID,
      { actorUserId: 'actor' },
    );

    expect(result).toEqual(['admin-1']);
  });

  it('delivers CALENDAR_BOOKING_CONFIRMED to a NEIGHBOR only when their email matches the booking resident', async () => {
    const prisma = makePrismaMock();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'admin-1', role: UserRole.TENANT_ADMIN, email: 'admin@x.com' },
      { id: 'neighbor-owner', role: UserRole.NEIGHBOR, email: 'owner@x.com' },
      { id: 'neighbor-other', role: UserRole.NEIGHBOR, email: 'other@x.com' },
    ]);
    // Resident email casing differs — the match must be case-insensitive.
    prisma.resident.findFirst.mockResolvedValueOnce({ email: 'Owner@X.com' });
    const service = makeService(prisma);

    const result = await service.resolveRecipientsForType(
      NotificationType.CALENDAR_BOOKING_CONFIRMED,
      CONDOMINIUM_ID,
      { eventData: { residentId: 'resident-1' } },
    );

    expect(result.sort()).toEqual(['admin-1', 'neighbor-owner'].sort());
  });

  it('drops every NEIGHBOR recipient when the booking resident email cannot be resolved', async () => {
    const prisma = makePrismaMock();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'admin-1', role: UserRole.TENANT_ADMIN, email: 'admin@x.com' },
      { id: 'neighbor-1', role: UserRole.NEIGHBOR, email: 'n1@x.com' },
    ]);
    prisma.resident.findFirst.mockResolvedValueOnce(null);
    const service = makeService(prisma);

    const result = await service.resolveRecipientsForType(
      NotificationType.CALENDAR_BOOKING_CONFIRMED,
      CONDOMINIUM_ID,
      { eventData: { residentId: 'missing' } },
    );

    expect(result).toEqual(['admin-1']);
  });
});

describe('NotificationsService.dispatchEvent', () => {
  it('resolves recipients and writes one notification per recipient', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);
    jest
      .spyOn(service, 'resolveRecipientsForType')
      .mockResolvedValue(['u1', 'u2', 'u3']);
    const createSpy = jest
      .spyOn(service, 'createForEvent')
      .mockResolvedValue({} as never);

    const result = await service.dispatchEvent({
      type: NotificationType.IMPORT_COMPLETED,
      condominiumId: CONDOMINIUM_ID,
      title: 'notifications.types.IMPORT_COMPLETED.title',
      message: 'notifications.types.IMPORT_COMPLETED.body',
      data: { batchId: 'b1' },
      linkUrl: '/link',
      actorUserId: 'actor-1',
    });

    expect(result).toEqual({ recipientCount: 3 });
    expect(createSpy).toHaveBeenCalledTimes(3);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        condominiumId: CONDOMINIUM_ID,
        type: NotificationType.IMPORT_COMPLETED,
        linkUrl: '/link',
      }),
    );
  });

  it('forwards actorUserId and event data to recipient resolution (actor exclusion)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);
    const resolveSpy = jest
      .spyOn(service, 'resolveRecipientsForType')
      .mockResolvedValue([]);
    jest.spyOn(service, 'createForEvent').mockResolvedValue({} as never);

    await service.dispatchEvent({
      type: NotificationType.CALENDAR_BOOKING_CONFIRMED,
      condominiumId: CONDOMINIUM_ID,
      title: 't',
      message: 'm',
      data: { residentId: 'res-1' },
      actorUserId: 'actor-1',
    });

    expect(resolveSpy).toHaveBeenCalledWith(
      NotificationType.CALENDAR_BOOKING_CONFIRMED,
      CONDOMINIUM_ID,
      { eventData: { residentId: 'res-1' }, actorUserId: 'actor-1' },
    );
  });

  it('writes nothing when the recipient set is empty', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);
    jest.spyOn(service, 'resolveRecipientsForType').mockResolvedValue([]);
    const createSpy = jest
      .spyOn(service, 'createForEvent')
      .mockResolvedValue({} as never);

    const result = await service.dispatchEvent({
      type: NotificationType.IMPORT_FAILED,
      condominiumId: CONDOMINIUM_ID,
      title: 't',
      message: 'm',
    });

    expect(result).toEqual({ recipientCount: 0 });
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.resolveCondominiumSlug', () => {
  it('returns the slug of a known condominium', async () => {
    const prisma = makePrismaMock();
    prisma.condominium.findUnique.mockResolvedValue({ slug: 'torres-del-sur' });
    const service = makeService(prisma);

    expect(await service.resolveCondominiumSlug(CONDOMINIUM_ID)).toBe(
      'torres-del-sur',
    );
  });

  it('returns null when the condominium does not exist', async () => {
    const prisma = makePrismaMock();
    prisma.condominium.findUnique.mockResolvedValue(null);
    const service = makeService(prisma);

    expect(await service.resolveCondominiumSlug('missing')).toBeNull();
  });
});
