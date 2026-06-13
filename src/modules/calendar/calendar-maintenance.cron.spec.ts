import { EventStatus, EventType } from '@prisma/client';
import { CalendarMaintenanceCron } from './calendar-maintenance.cron';

const NOW = new Date('2026-06-15T05:00:00Z');

interface PrismaMock {
  calendarEvent: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
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
    expect(where.childEvents).toEqual({ none: {} });
    expect(where.deletedAt.not).toBeNull();
    const row = audit.log.mock.calls[0][0];
    expect(row.action).toBe('CALENDAR_EVENT_PURGED');
    expect(row.userId).toBe('user-2'); // updatedById preferred over createdById
    expect(row.afterState.triggeredBy).toBe('system-calendar-maintenance');
  });
});
