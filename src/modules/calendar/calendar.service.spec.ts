import { CalendarEventVisibility, EventStatus, EventType } from '@prisma/client';
import { CalendarService } from './calendar.service';
import { MAX_TOTAL_OCCURRENCES } from './recurrence';

const CONDOMINIUM_ID = 'cond-1';
const EVENT_ID = 'evt-1';
const USER_ID = 'user-42';

// Phase 4: visibility derives from effective permissions, not the role claim.
const PERMS_MANAGE: ReadonlySet<string> = new Set(['calendar.read', 'calendar.manage']);
const PERMS_COUNCIL: ReadonlySet<string> = new Set(['calendar.read', 'calendar.viewCouncil']);
const PERMS_PUBLIC: ReadonlySet<string> = new Set(['calendar.read']);

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
  transaction: { findMany: jest.Mock };
}

interface AuditMock {
  log: jest.Mock;
}

interface EventEmitterMock {
  emit: jest.Mock;
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
    // CAL-011: no approved payment linked by default, so cancel/delete proceeds.
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeAuditMock(): AuditMock {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeEventEmitterMock(): EventEmitterMock {
  return { emit: jest.fn().mockReturnValue(true) };
}

function makeReconciliationMock(): { reopenTransaction: jest.Mock } {
  return { reopenTransaction: jest.fn().mockResolvedValue(undefined) };
}

function makeService(
  prisma: PrismaMock,
  audit: AuditMock,
  events: EventEmitterMock = makeEventEmitterMock(),
  reconciliation: { reopenTransaction: jest.Mock } = makeReconciliationMock(),
): CalendarService {
  return new CalendarService(
    prisma as never,
    audit as never,
    events as never,
    reconciliation as never,
  );
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
    visibility: CalendarEventVisibility.PUBLIC,
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

  // CAL-044: business 400s carry stable reason codes, not English prose, so the
  // web can map them without string-matching API copy.
  it('rejects create with a stable terraceDisabled reason when terrace bookings are off (CAL-044)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, makeAuditMock());
    prisma.condominiumSettings.findUnique.mockResolvedValueOnce({
      terraceBookingEnabled: false,
      terraceRentalAmount: 1500,
      terraceSecurityDepositAmount: 500,
    });

    await expect(
      service.create(CONDOMINIUM_ID, USER_ID, {
        title: 'Booking',
        eventType: EventType.TERRACE_BOOKING,
        startDate: PARENT_START.toISOString(),
        endDate: PARENT_END.toISOString(),
      } as never),
    ).rejects.toThrow('terraceDisabled');

    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('rejects create with a stable endDateAfterStart reason when end <= start (CAL-044)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, makeAuditMock());

    await expect(
      service.create(CONDOMINIUM_ID, USER_ID, {
        title: 'Backwards',
        eventType: EventType.GENERAL,
        startDate: PARENT_END.toISOString(),
        endDate: PARENT_START.toISOString(),
      } as never),
    ).rejects.toThrow('endDateAfterStart');

    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });

  // CAL-046: a terrace double-booking 409 carries a machine code so the web does
  // not have to assume every 409 is a slot conflict.
  it('rejects a terrace create on a slot conflict with a TERRACE_SLOT_CONFLICT code (CAL-046)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, makeAuditMock());
    prisma.condominiumSettings.findUnique.mockResolvedValueOnce({
      terraceBookingEnabled: true,
      terraceRentalAmount: 1500,
      terraceSecurityDepositAmount: 500,
    });
    // The conflict-detection findFirst returns an overlapping booking.
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({ id: 'existing-booking' });

    await service
      .create(CONDOMINIUM_ID, USER_ID, {
        title: 'Overlapping booking',
        eventType: EventType.TERRACE_BOOKING,
        startDate: PARENT_START.toISOString(),
        endDate: PARENT_END.toISOString(),
      } as never)
      .then(
        () => {
          throw new Error('expected the create to reject');
        },
        (err: { getResponse?: () => unknown }) => {
          expect(err.getResponse?.()).toMatchObject({
            code: 'TERRACE_SLOT_CONFLICT',
          });
        },
      );

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

  // A1 (Phase 4): the single-event read is bounded with `take` so it can never run unbounded.
  it('bounds the single-event query with take = MAX_TOTAL_OCCURRENCES + 1 (Phase 4 · A1)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([baseEvent({ startDate: PARENT_START, endDate: PARENT_END })])
      .mockResolvedValueOnce([]);

    await service.findAll(CONDOMINIUM_ID, listQuery() as never);

    const calls = prisma.calendarEvent.findMany.mock.calls;
    expect((calls[0][0] as { take?: number }).take).toBe(MAX_TOTAL_OCCURRENCES + 1);
    // recurring parents must stay unbounded — a `take` there could drop live series.
    expect((calls[1][0] as { take?: number }).take).toBeUndefined();
  });

  // A1 (Phase 4): single events alone can exceed the ceiling even with zero recurring events
  // (the recurrence guard never runs in that case). Fail loudly instead of returning an
  // unbounded result or silently truncating (which would skew meta.total).
  it('throws calendarTooMany when single events alone exceed the cap (Phase 4 · A1)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    const tooManySingles = Array.from({ length: MAX_TOTAL_OCCURRENCES + 1 }, (_, i) =>
      baseEvent({ id: `evt-${i}`, startDate: PARENT_START, endDate: PARENT_END }),
    );
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce(tooManySingles)
      .mockResolvedValueOnce([]);

    await expect(
      service.findAll(CONDOMINIUM_ID, listQuery() as never),
    ).rejects.toThrow('calendarTooMany');
  });

  // Boundary: exactly the cap must succeed and never be truncated (meta.total stays exact).
  it('returns all single events at exactly the cap without truncating (Phase 4 · A1)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    const atCap = Array.from({ length: MAX_TOTAL_OCCURRENCES }, (_, i) =>
      baseEvent({ id: `evt-${i}`, startDate: PARENT_START, endDate: PARENT_END }),
    );
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce(atCap)
      .mockResolvedValueOnce([]);

    const result = await service.findAll(CONDOMINIUM_ID, listQuery() as never);
    expect(result.meta.total).toBe(MAX_TOTAL_OCCURRENCES);
  });

  // Regression: mixed single + recurring events stay merged and sorted by startDate ascending.
  it('merges single and recurring events sorted by startDate ascending (Phase 4 · A1)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    const lateSingle = baseEvent({
      id: 'late-single',
      startDate: new Date('2026-06-20T10:00:00.000Z'),
      endDate: new Date('2026-06-20T11:00:00.000Z'),
    });
    const recurringParent = baseEvent({
      id: 'rec-1',
      recurrenceRule: 'FREQ=WEEKLY;COUNT=2',
      startDate: PARENT_START,
      endDate: PARENT_END,
    });
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([lateSingle])
      .mockResolvedValueOnce([recurringParent]);

    const result = await service.findAll(CONDOMINIUM_ID, listQuery() as never);
    const data = result.data as Array<{ id: string; startDate: Date }>;
    const starts = data.map((e) => e.startDate.getTime());
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
    expect(data.at(-1)?.id).toBe('late-single');
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

describe('CalendarService — Phase 5 input-validation hardening', () => {
  const FROM = '2026-06-01T00:00:00.000Z';
  const TO = '2026-06-30T23:59:59.999Z';
  const PARENT_UUID = '11111111-1111-1111-1111-111111111111';

  // CAL-023 — parentEventId must be tenant-scoped (mirrors the residentId guard).
  it('rejects create when parentEventId does not resolve in the tenant', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, makeAuditMock());
    // findFirst (parent lookup) resolves undefined by default → not found.

    await expect(
      service.create(CONDOMINIUM_ID, USER_ID, {
        title: 'Child event',
        eventType: EventType.GENERAL,
        startDate: '2026-06-15T14:00:00.000Z',
        endDate: '2026-06-15T15:00:00.000Z',
        parentEventId: PARENT_UUID,
      } as never),
    ).rejects.toThrow('Parent calendar event not found');

    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
    const parentLookup = prisma.calendarEvent.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(parentLookup.where).toMatchObject({
      id: PARENT_UUID,
      condominiumId: CONDOMINIUM_ID,
      deletedAt: null,
    });
  });

  it('accepts create when parentEventId resolves in the tenant', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, makeAuditMock());
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({ id: PARENT_UUID });
    prisma.calendarEvent.create.mockResolvedValueOnce(baseEvent({ parentEventId: PARENT_UUID }));

    await expect(
      service.create(CONDOMINIUM_ID, USER_ID, {
        title: 'Child event',
        eventType: EventType.GENERAL,
        startDate: '2026-06-15T14:00:00.000Z',
        endDate: '2026-06-15T15:00:00.000Z',
        parentEventId: PARENT_UUID,
      } as never),
    ).resolves.toBeDefined();

    expect(prisma.calendarEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects update when a changed parentEventId does not resolve in the tenant', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, makeAuditMock());
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent()) // findOne → existing (parentEventId: null)
      .mockResolvedValueOnce(null); // parent lookup → not found

    await expect(
      service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
        parentEventId: PARENT_UUID,
      } as never),
    ).rejects.toThrow('Parent calendar event not found');

    expect(prisma.calendarEvent.updateMany).not.toHaveBeenCalled();
  });

  // CAL-028 — invalid enum errors must enumerate allowed values without echoing input.
  it('does not reflect the raw invalid enum value back in the error message', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, makeAuditMock());
    const evil = '<script>alert(1)</script>';

    await expect(
      service.findAll(CONDOMINIUM_ID, { from: FROM, to: TO, type: evil } as never),
    ).rejects.toThrow('Invalid eventType. Valid values:');

    let captured: Error | undefined;
    try {
      await service.findAll(CONDOMINIUM_ID, { from: FROM, to: TO, status: evil } as never);
    } catch (err) {
      captured = err as Error;
    }
    expect(captured?.message).toContain('Invalid status. Valid values:');
    expect(captured?.message).not.toContain(evil);
  });
});

describe('CalendarService — Phase 5C visibility', () => {
  const FROM = '2026-06-01T00:00:00.000Z';
  const TO = '2026-06-30T23:59:59.999Z';
  const listQuery = (): { from: string; to: string } => ({ from: FROM, to: TO });

  it('defaults visibility to PUBLIC on create when omitted', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.create.mockResolvedValueOnce(baseEvent());

    await service.create(CONDOMINIUM_ID, USER_ID, {
      title: 'Default visibility',
      eventType: EventType.GENERAL,
      startDate: '2026-06-15T14:00:00.000Z',
      endDate: '2026-06-15T15:00:00.000Z',
    } as never);

    const args = prisma.calendarEvent.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.visibility).toBe(CalendarEventVisibility.PUBLIC);
  });

  it('persists each supported visibility value on create', async () => {
    for (const visibility of [
      CalendarEventVisibility.PUBLIC,
      CalendarEventVisibility.COUNCIL_ONLY,
      CalendarEventVisibility.PRIVATE,
    ]) {
      const prisma = makePrismaMock();
      const audit = makeAuditMock();
      const service = makeService(prisma, audit);
      prisma.calendarEvent.create.mockResolvedValueOnce(baseEvent({ visibility }));

      await service.create(CONDOMINIUM_ID, USER_ID, {
        title: 'Scoped',
        eventType: EventType.COUNCIL_MEETING,
        startDate: '2026-06-15T14:00:00.000Z',
        endDate: '2026-06-15T15:00:00.000Z',
        visibility,
      } as never);

      const args = prisma.calendarEvent.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(args.data.visibility).toBe(visibility);
    }
  });

  it('updates visibility when supplied and persists updatedById (regression)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent())
      .mockResolvedValueOnce(baseEvent({ visibility: CalendarEventVisibility.COUNCIL_ONLY }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      visibility: CalendarEventVisibility.COUNCIL_ONLY,
    } as never);

    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.visibility).toBe(CalendarEventVisibility.COUNCIL_ONLY);
    expect(args.data.updatedById).toBe(USER_ID);
  });

  it('omits visibility from update payload when the field is absent', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(baseEvent({ visibility: CalendarEventVisibility.PRIVATE }))
      .mockResolvedValueOnce(baseEvent({ visibility: CalendarEventVisibility.PRIVATE }));

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      title: 'Renamed only',
    } as never);

    const args = prisma.calendarEvent.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect('visibility' in args.data).toBe(false);
  });

  it('list omits the visibility WHERE clause for a manager (sees everything)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    await service.findAll(CONDOMINIUM_ID, listQuery() as never, PERMS_MANAGE);

    const singleArgs = prisma.calendarEvent.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(singleArgs.where.visibility).toBeUndefined();
  });

  it('list omits the visibility WHERE clause for calendar.viewPrivate (sees everything)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    await service.findAll(
      CONDOMINIUM_ID,
      listQuery() as never,
      new Set(['calendar.read', 'calendar.viewPrivate']),
    );

    const args = prisma.calendarEvent.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.visibility).toBeUndefined();
  });

  it('list filters calendar.viewCouncil to PUBLIC + COUNCIL_ONLY', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    await service.findAll(CONDOMINIUM_ID, listQuery() as never, PERMS_COUNCIL);

    const args = prisma.calendarEvent.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.visibility).toEqual({
      in: [CalendarEventVisibility.PUBLIC, CalendarEventVisibility.COUNCIL_ONLY],
    });
  });

  it('list restricts a read-only caller to PUBLIC only (hides COUNCIL_ONLY and PRIVATE)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    await service.findAll(CONDOMINIUM_ID, listQuery() as never, PERMS_PUBLIC);

    const args = prisma.calendarEvent.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.visibility).toEqual({ in: [CalendarEventVisibility.PUBLIC] });
  });

  it('list restricts an ungranted custom role (no view keys) to PUBLIC only — CAL-001', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    await service.findAll(CONDOMINIUM_ID, listQuery() as never, PERMS_PUBLIC);

    const args = prisma.calendarEvent.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.visibility).toEqual({ in: [CalendarEventVisibility.PUBLIC] });
  });

  it('findOne hides COUNCIL_ONLY events from a public-only caller (404)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(
      baseEvent({ visibility: CalendarEventVisibility.COUNCIL_ONLY }),
    );

    await expect(
      service.findOne(CONDOMINIUM_ID, EVENT_ID, PERMS_PUBLIC),
    ).rejects.toThrow('Calendar event not found');
  });

  it('findOne hides PRIVATE events from a council caller (404)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(
      baseEvent({ visibility: CalendarEventVisibility.PRIVATE }),
    );

    await expect(
      service.findOne(CONDOMINIUM_ID, EVENT_ID, PERMS_COUNCIL),
    ).rejects.toThrow('Calendar event not found');
  });

  it('findOne returns COUNCIL_ONLY events to a council caller', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(
      baseEvent({ visibility: CalendarEventVisibility.COUNCIL_ONLY }),
    );

    const result = (await service.findOne(
      CONDOMINIUM_ID,
      EVENT_ID,
      PERMS_COUNCIL,
    )) as Record<string, unknown>;

    expect(result.id).toBe(EVENT_ID);
    expect(result.visibility).toBe(CalendarEventVisibility.COUNCIL_ONLY);
  });

  it('findOne returns PRIVATE events to a manager', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(
      baseEvent({ visibility: CalendarEventVisibility.PRIVATE }),
    );

    const result = (await service.findOne(
      CONDOMINIUM_ID,
      EVENT_ID,
      PERMS_MANAGE,
    )) as Record<string, unknown>;

    expect(result.id).toBe(EVENT_ID);
    expect(result.visibility).toBe(CalendarEventVisibility.PRIVATE);
  });

  it('findOne still returns PUBLIC events to a public-only caller (regression)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(baseEvent());

    const result = (await service.findOne(
      CONDOMINIUM_ID,
      EVENT_ID,
      PERMS_PUBLIC,
    )) as Record<string, unknown>;

    expect(result.id).toBe(EVENT_ID);
    expect(result.visibility).toBe(CalendarEventVisibility.PUBLIC);
  });
});

// ─── Phase 5E — auto-reclassify trigger ──────────────────────────────────────

import { TERRACE_BOOKING_DEFAULTS } from './terrace-metadata.validator';
import { CALENDAR_TERRACE_CHANGED } from './events/calendar-terrace-changed.event';

function terraceMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...TERRACE_BOOKING_DEFAULTS, ...overrides };
}

function terraceEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return baseEvent({
    eventType: EventType.TERRACE_BOOKING,
    status: EventStatus.PENDING,
    startDate: new Date('2026-06-15T10:00:00Z'),
    endDate: new Date('2026-06-15T13:00:00Z'),
    residentId: 'res-1',
    unitNumber: '101',
    metadata: terraceMeta(),
    ...overrides,
  });
}

// Phase 3 added separate `calendar.event_created` / `calendar.event_cancelled`
// notification events on the same EventEmitter2. These reclassify-trigger
// tests assert only on the CALENDAR_TERRACE_CHANGED event, so they filter the
// emit calls down to that name rather than counting every emit.
function terraceChangeCalls(events: { emit: jest.Mock }) {
  return events.emit.mock.calls.filter(
    (call) => call[0] === CALENDAR_TERRACE_CHANGED,
  );
}

describe('CalendarService — Phase 5E auto-reclassify trigger', () => {
  it('emits calendar.terrace.changed on TERRACE_BOOKING create with action=create and 30d window', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const created = terraceEvent();
    prisma.calendarEvent.create.mockResolvedValueOnce(created);
    prisma.resident.findFirst.mockResolvedValueOnce({ id: 'res-1' });
    prisma.condominiumSettings.findUnique.mockResolvedValueOnce({
      terraceBookingEnabled: true,
      terraceRentalAmount: 1500,
      terraceSecurityDepositAmount: 1000,
    });

    await service.create(CONDOMINIUM_ID, USER_ID, {
      title: 'Terrace booking',
      eventType: EventType.TERRACE_BOOKING,
      startDate: '2026-06-15T10:00:00Z',
      endDate: '2026-06-15T13:00:00Z',
      residentId: 'res-1',
      unitNumber: '101',
    } as never);

    const terraceCalls = terraceChangeCalls(events);
    expect(terraceCalls).toHaveLength(1);
    const [name, payload] = terraceCalls[0];
    expect(name).toBe(CALENDAR_TERRACE_CHANGED);
    expect(payload.action).toBe('create');
    expect(payload.condominiumId).toBe(CONDOMINIUM_ID);
    const day = 24 * 60 * 60 * 1000;
    expect(payload.windowStart.getTime()).toBe(
      (created.startDate as Date).getTime() - 30 * day,
    );
    expect(payload.windowEnd.getTime()).toBe((created.startDate as Date).getTime());
  });

  it('does NOT emit on create for non-terrace events', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    prisma.calendarEvent.create.mockResolvedValueOnce(baseEvent());

    await service.create(CONDOMINIUM_ID, USER_ID, {
      title: 'Meeting',
      eventType: EventType.GENERAL,
      startDate: '2026-06-15T10:00:00Z',
      endDate: '2026-06-15T11:00:00Z',
    } as never);

    expect(terraceChangeCalls(events)).toHaveLength(0);
  });

  it('emits on TERRACE_BOOKING update when terraceRentalAmount changes', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent({ metadata: terraceMeta({ terraceRentalAmount: 1500 }) });
    const after = terraceEvent({ metadata: terraceMeta({ terraceRentalAmount: 3000 }) });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      metadata: { ...terraceMeta(), terraceRentalAmount: 3000 },
    } as never);

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls[0][1].action).toBe('update');
    expect(events.emit.mock.calls[0][1].reason).toContain('metadata');
  });

  it('emits on update when startDate changes; window covers both before and after', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent({
      startDate: new Date('2026-06-10T10:00:00Z'),
      endDate: new Date('2026-06-10T13:00:00Z'),
    });
    const after = terraceEvent({
      startDate: new Date('2026-07-01T10:00:00Z'),
      endDate: new Date('2026-07-01T13:00:00Z'),
    });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      startDate: '2026-07-01T10:00:00Z',
      endDate: '2026-07-01T13:00:00Z',
    } as never);

    expect(events.emit).toHaveBeenCalledTimes(1);
    const day = 24 * 60 * 60 * 1000;
    expect(events.emit.mock.calls[0][1].windowStart.getTime()).toBe(
      (before.startDate as Date).getTime() - 30 * day,
    );
    expect(events.emit.mock.calls[0][1].windowEnd.getTime()).toBe(
      (after.startDate as Date).getTime(),
    );
  });

  it('emits on update when residentId changes', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent({ residentId: 'res-1' });
    const after = terraceEvent({ residentId: 'res-2' });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(after);
    prisma.resident.findFirst.mockResolvedValueOnce({ id: 'res-2' });

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      residentId: 'res-2',
    } as never);

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls[0][1].reason).toContain('residentId');
  });

  it('emits on update when unitNumber changes', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent({ unitNumber: '101' });
    const after = terraceEvent({ unitNumber: '202' });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      unitNumber: '202',
    } as never);

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls[0][1].reason).toContain('unitNumber');
  });

  it('does NOT emit when only the title changes', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent({ title: 'Old' });
    const after = terraceEvent({ title: 'New' });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      title: 'New',
    } as never);

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit when only notes / description / location / visibility / timezone change', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent();
    const after = terraceEvent({
      notes: 'updated',
      description: 'updated',
      location: 'updated',
      visibility: CalendarEventVisibility.COUNCIL_ONLY,
      timezone: 'America/Mexico_City',
    });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      notes: 'updated',
      description: 'updated',
      location: 'updated',
      visibility: CalendarEventVisibility.COUNCIL_ONLY,
      timezone: 'America/Mexico_City',
    } as never);

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('emits on update when status transitions PENDING → CANCELLED', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent({ status: EventStatus.PENDING });
    const after = terraceEvent({ status: EventStatus.CANCELLED });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      status: EventStatus.CANCELLED,
    } as never);

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls[0][1].reason).toContain('status');
  });

  it('emits on update when paymentStatus flips PAID → PENDING', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent({ metadata: terraceMeta({ paymentStatus: 'PAID' }) });
    const after = terraceEvent({ metadata: terraceMeta({ paymentStatus: 'PENDING' }) });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      metadata: { ...terraceMeta(), paymentStatus: 'PENDING' },
    } as never);

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls[0][1].reason).toContain('metadata');
  });

  it('does NOT emit when both before and after are non-terrace', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = baseEvent({ title: 'Old' });
    const after = baseEvent({ title: 'New' });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      title: 'New',
    } as never);

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('emits when an event flips from non-terrace to TERRACE_BOOKING', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = baseEvent();
    const after = terraceEvent();
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(after);
    prisma.condominiumSettings.findUnique.mockResolvedValueOnce({
      terraceBookingEnabled: true,
      terraceRentalAmount: 1500,
      terraceSecurityDepositAmount: 1000,
    });

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      eventType: EventType.TERRACE_BOOKING,
    } as never);

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls[0][1].reason).toContain('flipToTerrace');
  });

  it('emits when an event flips from TERRACE_BOOKING to non-terrace', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    const before = terraceEvent();
    const after = baseEvent({ eventType: EventType.GENERAL, metadata: null });
    prisma.calendarEvent.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    await service.update(CONDOMINIUM_ID, USER_ID, EVENT_ID, {
      eventType: EventType.GENERAL,
    } as never);

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls[0][1].reason).toContain('flipFromTerrace');
  });

  it('emits on remove of a live TERRACE_BOOKING', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(terraceEvent());

    await service.remove(CONDOMINIUM_ID, USER_ID, EVENT_ID);

    const terraceCalls = terraceChangeCalls(events);
    expect(terraceCalls).toHaveLength(1);
    expect(terraceCalls[0][1].action).toBe('delete');
  });

  it('does NOT emit on remove when the event was already CANCELLED', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(
      terraceEvent({ status: EventStatus.CANCELLED }),
    );

    await service.remove(CONDOMINIUM_ID, USER_ID, EVENT_ID);

    expect(terraceChangeCalls(events)).toHaveLength(0);
  });

  it('does NOT emit on remove of a non-terrace event', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const events = makeEventEmitterMock();
    const service = makeService(prisma, audit, events);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(baseEvent());

    await service.remove(CONDOMINIUM_ID, USER_ID, EVENT_ID);

    expect(terraceChangeCalls(events)).toHaveLength(0);
  });
});

// ─── Phase 4 — terrace financial metadata redaction (CAL-002) ─────────────────

describe('CalendarService — terrace metadata redaction (CAL-002)', () => {
  const SENSITIVE = [
    'terraceRentalAmount',
    'securityDepositAmount',
    'paymentStatus',
    'securityDepositStatus',
    'depositDeductionAmount',
    'depositDeductionReason',
    'postEventReviewed',
    'damagesReported',
    'cleaningIssueReported',
    'postEventReviewNotes',
    'customKeywords',
  ];
  const SAFE = ['contractSigned', 'guestParkingRequested', 'setupNotes'];

  it('findOne strips financial metadata for a caller without calendar.manage', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(terraceEvent());

    const result = (await service.findOne(
      CONDOMINIUM_ID,
      EVENT_ID,
      PERMS_PUBLIC,
    )) as { metadata: Record<string, unknown> };

    for (const k of SENSITIVE) expect(result.metadata).not.toHaveProperty(k);
    for (const k of SAFE) expect(result.metadata).toHaveProperty(k);
  });

  it('findOne keeps full financial metadata for a manager', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findFirst.mockResolvedValueOnce(terraceEvent());

    const result = (await service.findOne(
      CONDOMINIUM_ID,
      EVENT_ID,
      PERMS_MANAGE,
    )) as { metadata: Record<string, unknown> };

    for (const k of SENSITIVE) expect(result.metadata).toHaveProperty(k);
  });

  it('findAll strips financial metadata from terrace events for non-managers', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([terraceEvent()]) // singles
      .mockResolvedValueOnce([]); // recurring parents

    const result = (await service.findAll(
      CONDOMINIUM_ID,
      { from: '2026-06-01T00:00:00Z', to: '2026-06-30T00:00:00Z' } as never,
      PERMS_COUNCIL,
    )) as { data: Array<{ metadata: Record<string, unknown> }> };

    expect(result.data).toHaveLength(1);
    for (const k of SENSITIVE) expect(result.data[0].metadata).not.toHaveProperty(k);
  });

  it('does not touch non-terrace events (metadata passes through untouched)', async () => {
    const prisma = makePrismaMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, audit);

    const generalMeta = { foo: 'bar', paymentStatus: 'PAID' };
    prisma.calendarEvent.findFirst.mockResolvedValueOnce(
      baseEvent({ eventType: EventType.GENERAL, metadata: generalMeta }),
    );

    const result = (await service.findOne(
      CONDOMINIUM_ID,
      EVENT_ID,
      PERMS_PUBLIC,
    )) as { metadata: Record<string, unknown> };

    expect(result.metadata).toEqual(generalMeta);
  });
});
