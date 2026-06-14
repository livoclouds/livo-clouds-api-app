import { EventStatus, EventType } from '@prisma/client';
import { CalendarMaintenanceCron } from './calendar-maintenance.cron';

const NOW = new Date('2026-06-15T05:00:00Z');

interface PrismaMock {
  calendarEvent: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  // Interactive $transaction — used only by scheduledSweep's leadership lock.
  $transaction: jest.Mock;
}
interface AuditMock {
  log: jest.Mock;
}
interface EventsMock {
  emit: jest.Mock;
}

function makePrisma(): PrismaMock {
  return {
    calendarEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // Default: the leadership lock is granted (locked: true), so the callback runs.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) }),
    ),
  };
}
function makeAudit(): AuditMock {
  return { log: jest.fn().mockResolvedValue(undefined) };
}
function makeEvents(): EventsMock {
  return { emit: jest.fn() };
}

function makeCron(prisma: PrismaMock, audit: AuditMock, events: EventsMock): CalendarMaintenanceCron {
  return new CalendarMaintenanceCron(prisma as never, audit as never, events as never);
}

function staleBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-stale',
    condominiumId: 'cond-1',
    createdById: 'user-1',
    startDate: new Date('2026-06-10T18:00:00Z'), // before NOW
    residentId: 'res-1',
    unitNumber: '101',
    metadata: null,
    eventType: EventType.TERRACE_BOOKING,
    ...overrides,
  };
}

describe('CalendarMaintenanceCron — Pass 1: stale PENDING expiry', () => {
  it('cancels a PENDING terrace booking whose event date has passed and audits the system action', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const events = makeEvents();
    // Pass 1 returns the stale booking; Pass 2 finds nothing.
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([staleBooking()])
      .mockResolvedValueOnce([]);

    const result = await makeCron(prisma, audit, events).sweep(NOW);

    expect(result.pendingExpired).toBe(1);
    expect(prisma.calendarEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'evt-stale', status: EventStatus.PENDING, deletedAt: null },
      data: { status: EventStatus.CANCELLED },
    });
    const row = audit.log.mock.calls[0][0];
    expect(row.userId).toBe('user-1');
    expect(row.action).toBe('CALENDAR_EVENT_EXPIRED');
    expect(row.afterState.triggeredBy).toBe('system-calendar-maintenance');
    // A re-match is triggered so reconciliation drops the cancelled candidate.
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('does not audit or emit when the conditional update is a no-op (booking already moved)', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const events = makeEvents();
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([staleBooking()])
      .mockResolvedValueOnce([]);
    prisma.calendarEvent.updateMany.mockResolvedValue({ count: 0 });

    const result = await makeCron(prisma, audit, events).sweep(NOW);

    expect(result.pendingExpired).toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('queries only past-start PENDING terrace bookings that are not soft-deleted', async () => {
    const prisma = makePrisma();
    await makeCron(prisma, makeAudit(), makeEvents()).sweep(NOW);
    const where = prisma.calendarEvent.findMany.mock.calls[0][0].where;
    expect(where.eventType).toBe(EventType.TERRACE_BOOKING);
    expect(where.status).toBe(EventStatus.PENDING);
    expect(where.deletedAt).toBeNull();
    expect(where.startDate.lt).toBeInstanceOf(Date);
  });
});

describe('CalendarMaintenanceCron — Pass 2: soft-delete retention purge', () => {
  it('hard-deletes only childless events soft-deleted past the retention window', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([]) // Pass 1
      .mockResolvedValueOnce([
        { id: 'evt-old', condominiumId: 'cond-1', createdById: 'user-1', updatedById: 'user-2' },
      ]);

    const result = await makeCron(prisma, audit, makeEvents()).sweep(NOW);

    expect(result.softDeletedPurged).toBe(1);
    const where = prisma.calendarEvent.findMany.mock.calls[1][0].where;
    // CAL-071 — only LIVE children block the purge (soft-deleted children don't).
    expect(where.childEvents).toEqual({ none: { deletedAt: null } });
    expect(where.deletedAt.not).toBeNull();
    const row = audit.log.mock.calls[0][0];
    expect(row.action).toBe('CALENDAR_EVENT_PURGED');
    expect(row.userId).toBe('user-2'); // updatedById preferred over createdById
    expect(row.afterState.triggeredBy).toBe('system-calendar-maintenance');
  });

  it('excludes bookings still referenced by a matched transaction (CAL-057)', async () => {
    const prisma = makePrisma();
    await makeCron(prisma, makeAudit(), makeEvents()).sweep(NOW);
    // The purge query (Pass 2) must never select a financially-referenced row —
    // its FK is RESTRICT, so deleting it would throw P2003 and re-error nightly.
    const where = prisma.calendarEvent.findMany.mock.calls[1][0].where;
    expect(where.matchedTransactions).toEqual({ none: {} });
  });
});

describe('CalendarMaintenanceCron — scheduledSweep leadership lock (CAL-059)', () => {
  it('runs the sweep when it acquires the advisory lock', async () => {
    const prisma = makePrisma();
    const cron = makeCron(prisma, makeAudit(), makeEvents());
    const sweepSpy = jest
      .spyOn(cron, 'sweep')
      .mockResolvedValue({ pendingExpired: 0, softDeletedPurged: 0 });

    await cron.scheduledSweep();

    expect(sweepSpy).toHaveBeenCalledTimes(1);
  });

  it('skips the sweep when another replica holds the advisory lock', async () => {
    const prisma = makePrisma();
    // Lock not acquired → callback returns acquired:false, sweep never runs.
    prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: jest.fn().mockResolvedValue([{ locked: false }]) }),
    );
    const cron = makeCron(prisma, makeAudit(), makeEvents());
    const sweepSpy = jest.spyOn(cron, 'sweep');

    await cron.scheduledSweep();

    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it('swallows a sweep failure so the scheduler stays healthy', async () => {
    const prisma = makePrisma();
    const cron = makeCron(prisma, makeAudit(), makeEvents());
    jest.spyOn(cron, 'sweep').mockRejectedValue(new Error('boom'));

    await expect(cron.scheduledSweep()).resolves.toBeUndefined();
  });
});
