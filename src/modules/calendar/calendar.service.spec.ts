import { EventStatus, EventType } from '@prisma/client';
import { CalendarService } from './calendar.service';

const CONDOMINIUM_ID = 'cond-1';
const EVENT_ID = 'evt-1';
const USER_ID = 'user-42';

interface PrismaMock {
  calendarEvent: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  resident: { findFirst: jest.Mock };
  condominiumSettings: { findUnique: jest.Mock };
}

interface AuditMock {
  log: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  return {
    calendarEvent: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    resident: { findFirst: jest.fn().mockResolvedValue(null) },
    condominiumSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

function makeAuditMock(): AuditMock {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeService(prisma: PrismaMock, audit: AuditMock): CalendarService {
  return new CalendarService(prisma as never, audit as never);
}

function baseEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT_ID,
    condominiumId: CONDOMINIUM_ID,
    title: 'Original',
    description: null,
    eventType: EventType.GENERAL,
    startDate: new Date('2026-06-15T10:00:00Z'),
    endDate: new Date('2026-06-15T11:00:00Z'),
    allDay: false,
    location: null,
    unitNumber: null,
    residentId: null,
    createdById: 'creator-1',
    updatedById: null,
    status: EventStatus.PENDING,
    notes: null,
    metadata: null,
    recurrenceRule: null,
    parentEventId: null,
    timezone: null,
    deletedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    resident: null,
    createdBy: { id: 'creator-1', firstName: 'Creator', lastName: 'User' },
    updatedBy: null,
    ...overrides,
  };
}

describe('CalendarService.update — Phase 3 audit field (updatedById)', () => {
  it('persists updatedById = req.user.sub on the row when an event is updated', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent())
      .mockResolvedValueOnce(baseEvent({ title: 'Renamed' }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, { title: 'Renamed' });

    expect(prisma.calendarEvent.updateMany).toHaveBeenCalledTimes(1);
    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({ id: EVENT_ID, condominiumId: CONDOMINIUM_ID, deletedAt: null });
    expect(args.data.updatedById).toBe(USER_ID);
    expect(args.data.title).toBe('Renamed');
  });

  it('continues to write the CALENDAR_EVENT_UPDATED audit log entry', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent())
      .mockResolvedValueOnce(baseEvent({ title: 'Renamed' }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, { title: 'Renamed' });

    expect(audit.log).toHaveBeenCalledTimes(1);
    const auditArgs = audit.log.mock.calls[0][0] as Record<string, unknown>;
    expect(auditArgs.action).toBe('CALENDAR_EVENT_UPDATED');
    expect(auditArgs.userId).toBe(USER_ID);
    expect(auditArgs.condominiumId).toBe(CONDOMINIUM_ID);
    expect(auditArgs.entityType).toBe('CalendarEvent');
    expect(auditArgs.entityId).toBe(EVENT_ID);
    expect(auditArgs.beforeState).toBeDefined();
    expect(auditArgs.afterState).toBeDefined();
  });
});

describe('CalendarService.findOne — Phase 3 last-editor exposure', () => {
  it('returns the embedded updatedBy user when populated', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    const editor = { id: 'editor-7', firstName: 'Edith', lastName: 'Reviewer' };
    prisma.calendarEvent.findFirst.mockResolvedValueOnce(
      baseEvent({ updatedById: editor.id, updatedBy: editor }),
    );

    const result = (await service.findOne(CONDOMINIUM_ID, EVENT_ID)) as Record<string, unknown>;

    expect(result.updatedById).toBe(editor.id);
    expect(result.updatedBy).toEqual(editor);

    const args = prisma.calendarEvent.findFirst.mock.calls[0][0] as {
      include: Record<string, unknown>;
    };
    expect(args.include.updatedBy).toEqual({
      select: { id: true, firstName: true, lastName: true },
    });
  });

  it('does not throw for legacy rows where updatedById is null', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(baseEvent());

    const result = (await service.findOne(CONDOMINIUM_ID, EVENT_ID)) as Record<string, unknown>;

    expect(result.updatedById).toBeNull();
    expect(result.updatedBy).toBeNull();
  });
});

describe('CalendarService — Phase 5A recurrence', () => {
  const FROM = '2026-06-01T00:00:00.000Z';
  const TO = '2026-06-30T23:59:59.999Z';
  const PARENT_START = new Date('2026-06-01T18:00:00.000Z');
  const PARENT_END = new Date('2026-06-01T20:00:00.000Z');

  function listQuery(): { from: string; to: string } {
    return { from: FROM, to: TO };
  }

  it('returns a single non-recurring event unchanged (regression)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([baseEvent({ startDate: PARENT_START, endDate: PARENT_END })])
      .mockResolvedValueOnce([]);

    const result = await service.findAll(CONDOMINIUM_ID, listQuery() as never);

    expect(result.data).toHaveLength(1);
    const data = result.data as Array<Record<string, unknown>>;
    expect(data[0].id).toBe(EVENT_ID);
    expect(data[0].isOccurrence).toBeUndefined();
  });

  it('expands a weekly recurring parent into 4 occurrences across a 28-day window', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        baseEvent({
          id: 'parent-weekly',
          startDate: PARENT_START,
          endDate: PARENT_END,
          recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
        }),
      ]);

    const result = await service.findAll(CONDOMINIUM_ID, listQuery() as never);

    expect(result.data).toHaveLength(4);
    const data = result.data as Array<Record<string, unknown>>;
    expect(data.every((occ) => occ.isOccurrence === true)).toBe(true);
    expect(data.every((occ) => occ.originalEventId === 'parent-weekly')).toBe(true);
    expect(new Set(data.map((occ) => occ.id)).size).toBe(4);
    expect(data[0].id).toContain('parent-weekly::');
  });

  it('filters soft-deleted recurring events at the Prisma layer', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.findAll(CONDOMINIUM_ID, listQuery() as never);

    const singleArgs = prisma.calendarEvent.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    const recurringArgs = prisma.calendarEvent.findMany.mock.calls[1][0] as {
      where: Record<string, unknown>;
    };
    expect(singleArgs.where.deletedAt).toBeNull();
    expect(recurringArgs.where.deletedAt).toBeNull();
    expect(singleArgs.where.recurrenceRule).toBeNull();
    expect(recurringArgs.where.recurrenceRule).toEqual({ not: null });
  });

  it('rejects create when eventType is TERRACE_BOOKING and recurrenceRule is set', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);
    prisma.condominiumSettings.findUnique.mockResolvedValueOnce({
      terraceBookingEnabled: true,
      terraceRentalAmount: 1500,
      terraceSecurityDepositAmount: 500,
    });

    await expect(
      service.create(CONDOMINIUM_ID, USER_ID, {
        title: 'Recurring booking',
        eventType: EventType.TERRACE_BOOKING,
        startDate: PARENT_START.toISOString(),
        endDate: PARENT_END.toISOString(),
        recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
      } as never),
    ).rejects.toThrow('recurrenceTerraceUnsupported');

    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('rejects create when recurrenceRule is unbounded', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    await expect(
      service.create(CONDOMINIUM_ID, USER_ID, {
        title: 'Open-ended series',
        eventType: EventType.GENERAL,
        startDate: PARENT_START.toISOString(),
        endDate: PARENT_END.toISOString(),
        recurrenceRule: 'FREQ=DAILY',
      } as never),
    ).rejects.toThrow('recurrenceUnbounded');

    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('throws when expanded occurrences exceed MAX_TOTAL_OCCURRENCES', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    // 7 daily parents × 300 occurrences = 2100, just over the 2000 aggregate cap.
    const bigParents = Array.from({ length: 7 }, (_, i) =>
      baseEvent({
        id: `big-${i}`,
        startDate: PARENT_START,
        endDate: PARENT_END,
        recurrenceRule: 'FREQ=DAILY;COUNT=300',
      }),
    );
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(bigParents);

    const yearQuery = { from: '2026-06-01T00:00:00.000Z', to: '2027-05-31T23:59:59.999Z' };

    await expect(
      service.findAll(CONDOMINIUM_ID, yearQuery as never),
    ).rejects.toThrow('recurrenceTooMany');
  });

  it('persists recurrenceRule and updatedById on update (regression for Phase 3 audit)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent({ startDate: PARENT_START, endDate: PARENT_END }))
      .mockResolvedValueOnce(
        baseEvent({
          startDate: PARENT_START,
          endDate: PARENT_END,
          recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
        }),
      );

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
    } as never);

    expect(prisma.calendarEvent.updateMany).toHaveBeenCalledTimes(1);
    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.recurrenceRule).toBe('FREQ=WEEKLY;COUNT=4');
    expect(args.data.updatedById).toBe(USER_ID);

    expect(audit.log).toHaveBeenCalledTimes(1);
    const auditArgs = audit.log.mock.calls[0][0] as Record<string, unknown>;
    expect(auditArgs.action).toBe('CALENDAR_EVENT_UPDATED');
    const after = auditArgs.afterState as Record<string, unknown>;
    expect(after.recurrenceRule).toBe('FREQ=WEEKLY;COUNT=4');
  });

  it('persists per-event timezone on create (Phase 5B)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.create.mockResolvedValueOnce(
      baseEvent({ timezone: 'America/New_York' }),
    );

    await service.create(CONDOMINIUM_ID, USER_ID, {
      title: 'Cross-tz provider visit',
      eventType: EventType.PROVIDER,
      startDate: '2026-06-15T14:00:00.000Z',
      endDate: '2026-06-15T15:00:00.000Z',
      timezone: 'America/New_York',
    } as never);

    expect(prisma.calendarEvent.create).toHaveBeenCalledTimes(1);
    const args = prisma.calendarEvent.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.timezone).toBe('America/New_York');
  });

  it('rejects create when timezone is not a valid IANA zone (Phase 5B)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    await expect(
      service.create(CONDOMINIUM_ID, USER_ID, {
        title: 'Bad tz',
        eventType: EventType.GENERAL,
        startDate: '2026-06-15T14:00:00.000Z',
        endDate: '2026-06-15T15:00:00.000Z',
        timezone: 'Mars/Olympus_Mons',
      } as never),
    ).rejects.toThrow('invalidTimezone');

    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('updates per-event timezone (Phase 5B)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent())
      .mockResolvedValueOnce(baseEvent({ timezone: 'Europe/Madrid' }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      timezone: 'Europe/Madrid',
    } as never);

    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.timezone).toBe('Europe/Madrid');
    expect(args.data.updatedById).toBe(USER_ID);
  });

  it('clears per-event timezone when update sends null (Phase 5B)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent({ timezone: 'America/New_York' }))
      .mockResolvedValueOnce(baseEvent({ timezone: null }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      timezone: null,
    } as never);

    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.timezone).toBeNull();
  });

  it('treats an empty-string timezone in update as a clear (Phase 5B)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent({ timezone: 'America/New_York' }))
      .mockResolvedValueOnce(baseEvent({ timezone: null }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      timezone: '',
    } as never);

    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.timezone).toBeNull();
  });

  it('rejects update when timezone is not a valid IANA zone (Phase 5B)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(baseEvent());

    await expect(
      service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
        timezone: 'not-a-timezone',
      } as never),
    ).rejects.toThrow('invalidTimezone');

    expect(prisma.calendarEvent.updateMany).not.toHaveBeenCalled();
  });

  it('omits timezone from update payload when the field is absent (Phase 5B)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent({ timezone: 'America/New_York' }))
      .mockResolvedValueOnce(baseEvent({ timezone: 'America/New_York' }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      title: 'Renamed',
    } as never);

    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect('timezone' in args.data).toBe(false);
  });

  it('clears recurrenceRule when update sends null (revert to single event)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(
        baseEvent({
          startDate: PARENT_START,
          endDate: PARENT_END,
          recurrenceRule: 'FREQ=DAILY;COUNT=10',
        }),
      )
      .mockResolvedValueOnce(baseEvent({ startDate: PARENT_START, endDate: PARENT_END }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      recurrenceRule: null,
    } as never);

    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.recurrenceRule).toBeNull();
  });
});
