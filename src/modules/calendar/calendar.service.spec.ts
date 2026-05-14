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
