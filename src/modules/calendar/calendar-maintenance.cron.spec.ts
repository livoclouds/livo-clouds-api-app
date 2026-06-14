import * as Sentry from '@sentry/nestjs';
import { EventStatus, EventType } from '@prisma/client';
import { CalendarMaintenanceCron } from './calendar-maintenance.cron';

// CAL-060: assert the cron now raises alertable Sentry signals (it had none).
jest.mock('@sentry/nestjs');

const NOW = new Date('2026-06-15T05:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
});

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

  // CAL-069 — purge-pass edge cases beyond the happy path.

  it('does not audit when the conditional delete is a no-op (row already changed underneath)', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([]) // Pass 1
      .mockResolvedValueOnce([
        { id: 'evt-old', condominiumId: 'cond-1', createdById: 'user-1', updatedById: 'user-2' },
      ]);
    // The row no longer matches the deletedAt+cutoff guard at delete time.
    prisma.calendarEvent.deleteMany.mockResolvedValue({ count: 0 });

    const result = await makeCron(prisma, audit, makeEvents()).sweep(NOW);

    expect(result.softDeletedPurged).toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('purges multiple eligible rows in a single pass and audits each', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([]) // Pass 1
      .mockResolvedValueOnce([
        { id: 'evt-a', condominiumId: 'cond-1', createdById: 'user-1', updatedById: 'user-2' },
        { id: 'evt-b', condominiumId: 'cond-1', createdById: 'user-3', updatedById: 'user-4' },
      ]);

    const result = await makeCron(prisma, audit, makeEvents()).sweep(NOW);

    expect(result.softDeletedPurged).toBe(2);
    expect(prisma.calendarEvent.deleteMany).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log.mock.calls.map((c) => c[0].entityId).sort()).toEqual(['evt-a', 'evt-b']);
  });

  it('attributes the purge audit to createdById when updatedById is null (CAL-069 fallback)', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([]) // Pass 1
      .mockResolvedValueOnce([
        { id: 'evt-old', condominiumId: 'cond-1', createdById: 'creator-9', updatedById: null },
      ]);

    await makeCron(prisma, audit, makeEvents()).sweep(NOW);

    const row = audit.log.mock.calls[0][0];
    expect(row.action).toBe('CALENDAR_EVENT_PURGED');
    expect(row.userId).toBe('creator-9'); // updatedById ?? createdById
  });

  it('continues purging the remaining rows after one row throws', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([]) // Pass 1
      .mockResolvedValueOnce([
        { id: 'evt-bad', condominiumId: 'cond-1', createdById: 'user-1', updatedById: null },
        { id: 'evt-good', condominiumId: 'cond-1', createdById: 'user-1', updatedById: null },
      ]);
    prisma.calendarEvent.deleteMany
      .mockRejectedValueOnce(new Error('row boom')) // evt-bad
      .mockResolvedValueOnce({ count: 1 }); // evt-good

    const result = await makeCron(prisma, audit, makeEvents()).sweep(NOW);

    // The bad row is swallowed; the good row still purges and audits.
    expect(result.softDeletedPurged).toBe(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0][0].entityId).toBe('evt-good');
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

describe('CalendarMaintenanceCron — observability (CAL-060)', () => {
  it('emits a machine-parseable metric line with the sweep counts', async () => {
    const prisma = makePrisma();
    const cron = makeCron(prisma, makeAudit(), makeEvents());
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([staleBooking()]) // Pass 1 → 1 expired
      .mockResolvedValueOnce([]); // Pass 2 → 0 purged
    const logSpy = jest.spyOn(
      (cron as unknown as { logger: { log: (m: string) => void } }).logger,
      'log',
    );

    await cron.sweep(NOW);

    expect(logSpy).toHaveBeenCalledWith(
      'metric calendar_maintenance_sweep pendingExpired=1 softDeletedPurged=0',
    );
  });

  it('captures a top-level sweep failure to Sentry', async () => {
    const prisma = makePrisma();
    const cron = makeCron(prisma, makeAudit(), makeEvents());
    const err = new Error('boom');
    jest.spyOn(cron, 'sweep').mockRejectedValue(err);

    await cron.scheduledSweep();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [captured, options] = (Sentry.captureException as jest.Mock).mock.calls[0];
    expect(captured).toBe(err);
    expect(options.extra.phase).toBe('sweep');
  });

  it('captures a per-row expiry failure to Sentry and continues the sweep', async () => {
    const prisma = makePrisma();
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([staleBooking()])
      .mockResolvedValueOnce([]);
    prisma.calendarEvent.updateMany.mockRejectedValue(new Error('row boom'));
    const cron = makeCron(prisma, makeAudit(), makeEvents());

    const result = await cron.sweep(NOW);

    expect(result.pendingExpired).toBe(0); // failure swallowed
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const options = (Sentry.captureException as jest.Mock).mock.calls[0][1];
    expect(options.tags.eventId).toBe('evt-stale');
    expect(options.extra.pass).toBe('expire-pending');
  });

  it('captures a per-row purge failure to Sentry and continues the sweep', async () => {
    const prisma = makePrisma();
    prisma.calendarEvent.findMany
      .mockResolvedValueOnce([]) // Pass 1
      .mockResolvedValueOnce([
        { id: 'evt-old', condominiumId: 'cond-1', createdById: 'user-1', updatedById: null },
      ]);
    prisma.calendarEvent.deleteMany.mockRejectedValue(new Error('purge boom'));
    const cron = makeCron(prisma, makeAudit(), makeEvents());

    const result = await cron.sweep(NOW);

    expect(result.softDeletedPurged).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const options = (Sentry.captureException as jest.Mock).mock.calls[0][1];
    expect(options.tags.eventId).toBe('evt-old');
    expect(options.extra.pass).toBe('purge-soft-deleted');
  });
});
