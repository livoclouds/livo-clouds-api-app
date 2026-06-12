/**
 * Calendar service integration test (CAL-007 — service-layer safety net).
 *
 * Drives CalendarService against a REAL Postgres: create/read round-trip,
 * tenant isolation, terrace double-booking conflicts, RRULE caps and
 * expansion, soft delete, update guards and visibility filtering. Same
 * harness contract as pipeline.integration.spec.ts: `describeIntegration`
 * self-skips when no TEST_DATABASE_URL is configured.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventStatus, EventType, type Prisma } from '@prisma/client';

import { UserRole } from '../../src/common/types';
import {
  CreateCalendarEventDto,
  EventTypeDto,
  CalendarEventVisibilityDto,
} from '../../src/modules/calendar/dto/create-calendar-event.dto';
import type { ListCalendarEventsDto } from '../../src/modules/calendar/dto/list-calendar-events.dto';
import type { UpdateCalendarEventDto } from '../../src/modules/calendar/dto/update-calendar-event.dto';
import {
  closePipelineContext,
  createPipelineContext,
  describeIntegration,
  PipelineContext,
  resetDb,
} from './db';

// June 2026 keeps every fixture inside one month and the 365-day range guard.
const RANGE_FROM = '2026-06-01T00:00:00.000Z';
const RANGE_TO = '2026-06-30T23:59:59.999Z';

interface SeededTenant {
  condominiumId: string;
  userId: string;
  residentId: string;
}

/** Minimal valid tenant graph: condominium + settings + actor user + resident. */
async function seedTenant(ctx: PipelineContext, slug: string): Promise<SeededTenant> {
  const { prisma } = ctx;

  const condo = await prisma.condominium.create({
    data: { slug, name: `Calendar IT ${slug}` },
  });

  await prisma.condominiumSettings.create({
    data: { condominiumId: condo.id, currency: 'MXN', totalUnits: 200 },
  });

  const user = await prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `actor-${condo.id}@example.test`,
      passwordHash: 'x', // never authenticated here
      firstName: 'Cal',
      lastName: 'Actor',
    },
  });

  const resident = await prisma.resident.create({
    data: {
      condominiumId: condo.id,
      unitNumber: '101',
      unitNumberNormalized: '101',
      firstName: 'Ana',
      lastName: 'García',
    },
  });

  return { condominiumId: condo.id, userId: user.id, residentId: resident.id };
}

function eventDto(overrides: Partial<CreateCalendarEventDto> = {}): CreateCalendarEventDto {
  return {
    title: 'Integration event',
    eventType: EventTypeDto.GENERAL,
    startDate: '2026-06-15T10:00:00.000Z',
    endDate: '2026-06-15T12:00:00.000Z',
    ...overrides,
  } as CreateCalendarEventDto;
}

function listQuery(overrides: Partial<ListCalendarEventsDto> = {}): ListCalendarEventsDto {
  return { from: RANGE_FROM, to: RANGE_TO, ...overrides } as ListCalendarEventsDto;
}

/** Valid terrace metadata used to keep terrace fixtures deterministic. */
function terraceMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    terraceRentalAmount: 1500,
    securityDepositAmount: 1000,
    paymentStatus: 'PENDING',
    securityDepositStatus: 'PENDING',
    contractSigned: false,
    guestParkingRequested: false,
    setupNotes: '',
    customKeywords: [],
    ...overrides,
  };
}

describeIntegration('calendar service (integration)', () => {
  let ctx: PipelineContext;
  let tenant: SeededTenant;

  beforeAll(async () => {
    ctx = await createPipelineContext();
  });

  afterAll(async () => {
    if (ctx) await closePipelineContext(ctx);
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    tenant = await seedTenant(ctx, `cal-${Date.now()}`);
  });

  // ── Round-trip ─────────────────────────────────────────────────────────────

  it('create → findOne → findAll round-trip, condominium-scoped', async () => {
    const created = (await ctx.calendar.create(
      tenant.condominiumId,
      tenant.userId,
      eventDto({ title: 'Asamblea Junio', residentId: tenant.residentId }),
    )) as { id: string; title: string; condominiumId: string };

    expect(created.id).toBeDefined();
    expect(created.condominiumId).toBe(tenant.condominiumId);

    const fetched = (await ctx.calendar.findOne(tenant.condominiumId, created.id)) as {
      id: string;
      title: string;
      resident: { id: string } | null;
      createdBy: { id: string };
    };
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe('Asamblea Junio');
    expect(fetched.resident?.id).toBe(tenant.residentId);
    expect(fetched.createdBy.id).toBe(tenant.userId);

    const list = await ctx.calendar.findAll(tenant.condominiumId, listQuery());
    expect(list.meta.total).toBe(1);
    expect((list.data as Array<{ id: string }>)[0].id).toBe(created.id);
  });

  // ── Tenant isolation ───────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    let other: SeededTenant;

    beforeEach(async () => {
      other = await seedTenant(ctx, `cal-other-${Date.now()}`);
    });

    it("events from tenant A are invisible to tenant B's findAll/findOne", async () => {
      const created = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto(),
      )) as { id: string };

      const listB = await ctx.calendar.findAll(other.condominiumId, listQuery());
      expect(listB.meta.total).toBe(0);
      expect(listB.data).toHaveLength(0);

      await expect(
        ctx.calendar.findOne(other.condominiumId, created.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("create in tenant A rejects a residentId belonging to tenant B", async () => {
      await expect(
        ctx.calendar.create(
          tenant.condominiumId,
          tenant.userId,
          eventDto({ residentId: other.residentId }),
        ),
      ).rejects.toThrow('Resident not found');

      // Nothing was written.
      const list = await ctx.calendar.findAll(tenant.condominiumId, listQuery());
      expect(list.meta.total).toBe(0);
    });
  });

  // ── Terrace double-booking ─────────────────────────────────────────────────

  describe('terrace double-booking', () => {
    const terraceDto = (start: string, end: string): CreateCalendarEventDto =>
      eventDto({
        title: 'Terraza',
        eventType: EventTypeDto.TERRACE_BOOKING,
        startDate: start,
        endDate: end,
        metadata: terraceMetadata(),
      });

    it('rejects an overlapping TERRACE_BOOKING with ConflictException', async () => {
      await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        terraceDto('2026-06-20T18:00:00.000Z', '2026-06-20T22:00:00.000Z'),
      );

      await expect(
        ctx.calendar.create(
          tenant.condominiumId,
          tenant.userId,
          terraceDto('2026-06-20T20:00:00.000Z', '2026-06-20T23:00:00.000Z'),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('a CANCELLED terrace booking does not block the slot', async () => {
      // Seed the cancelled booking directly — status transitions are not the
      // concern of this test, slot availability is.
      await ctx.prisma.calendarEvent.create({
        data: {
          condominiumId: tenant.condominiumId,
          createdById: tenant.userId,
          title: 'Cancelled terrace',
          eventType: EventType.TERRACE_BOOKING,
          status: EventStatus.CANCELLED,
          startDate: new Date('2026-06-20T18:00:00.000Z'),
          endDate: new Date('2026-06-20T22:00:00.000Z'),
          metadata: terraceMetadata() as Prisma.InputJsonValue,
        },
      });

      const created = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        terraceDto('2026-06-20T19:00:00.000Z', '2026-06-20T21:00:00.000Z'),
      )) as { id: string };

      expect(created.id).toBeDefined();
    });
  });

  // ── Recurrence ─────────────────────────────────────────────────────────────

  describe('recurrence rules', () => {
    it('rejects a COUNT above the per-event cap (366)', async () => {
      await expect(
        ctx.calendar.create(
          tenant.condominiumId,
          tenant.userId,
          eventDto({ recurrenceRule: 'FREQ=DAILY;COUNT=400' }),
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        ctx.calendar.create(
          tenant.condominiumId,
          tenant.userId,
          eventDto({ recurrenceRule: 'FREQ=DAILY;COUNT=400' }),
        ),
      ).rejects.toThrow('recurrenceTooMany');
    });

    it('expands a valid weekly rule into occurrences inside the range', async () => {
      const parent = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto({
          title: 'Weekly maintenance',
          startDate: '2026-06-01T09:00:00.000Z',
          endDate: '2026-06-01T10:00:00.000Z',
          recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
        }),
      )) as { id: string };

      const list = await ctx.calendar.findAll(tenant.condominiumId, listQuery());
      const data = list.data as Array<{
        id: string;
        isOccurrence?: boolean;
        originalEventId?: string;
        startDate: Date;
      }>;

      // 4 expanded occurrences (Jun 1, 8, 15, 22), each pointing at the parent.
      expect(list.meta.total).toBe(4);
      for (const occ of data) {
        expect(occ.isOccurrence).toBe(true);
        expect(occ.originalEventId).toBe(parent.id);
        expect(occ.id).toContain(parent.id);
      }
      const starts = data.map((o) => new Date(o.startDate).toISOString());
      expect(starts).toEqual([
        '2026-06-01T09:00:00.000Z',
        '2026-06-08T09:00:00.000Z',
        '2026-06-15T09:00:00.000Z',
        '2026-06-22T09:00:00.000Z',
      ]);
    });
  });

  // ── Soft delete ────────────────────────────────────────────────────────────

  it('remove() soft-deletes: findAll and findOne exclude the event', async () => {
    const created = (await ctx.calendar.create(
      tenant.condominiumId,
      tenant.userId,
      eventDto(),
    )) as { id: string };

    await ctx.calendar.remove(tenant.condominiumId, tenant.userId, created.id);

    const list = await ctx.calendar.findAll(tenant.condominiumId, listQuery());
    expect(list.meta.total).toBe(0);

    await expect(
      ctx.calendar.findOne(tenant.condominiumId, created.id),
    ).rejects.toThrow(NotFoundException);

    // Soft delete, not hard delete: the row survives with deletedAt stamped.
    const row = await ctx.prisma.calendarEvent.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  // ── Update guards ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('rejects endDate <= startDate', async () => {
      const created = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto(),
      )) as { id: string };

      await expect(
        ctx.calendar.update(tenant.condominiumId, tenant.userId, created.id, {
          endDate: '2026-06-15T09:00:00.000Z', // before the existing 10:00 start
        } as UpdateCalendarEventDto),
      ).rejects.toThrow('endDate must be after startDate');
    });

    it('clears terrace metadata when the eventType flips away from TERRACE_BOOKING', async () => {
      const created = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto({
          eventType: EventTypeDto.TERRACE_BOOKING,
          metadata: terraceMetadata(),
        }),
      )) as { id: string; metadata: unknown };
      expect(created.metadata).not.toBeNull();

      const updated = (await ctx.calendar.update(
        tenant.condominiumId,
        tenant.userId,
        created.id,
        { eventType: EventTypeDto.GENERAL } as unknown as UpdateCalendarEventDto,
      )) as { eventType: string; metadata: unknown };

      expect(updated.eventType).toBe(EventType.GENERAL);
      expect(updated.metadata).toBeNull();
    });
  });

  // ── Visibility ─────────────────────────────────────────────────────────────

  describe('visibility filtering', () => {
    it('RESIDENT role sees PUBLIC events only in findAll and findOne', async () => {
      const publicEvent = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto({ title: 'Public', visibility: CalendarEventVisibilityDto.PUBLIC }),
      )) as { id: string };
      const privateEvent = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto({
          title: 'Private',
          startDate: '2026-06-16T10:00:00.000Z',
          endDate: '2026-06-16T12:00:00.000Z',
          visibility: CalendarEventVisibilityDto.PRIVATE,
        }),
      )) as { id: string };

      // Admin sees both.
      const adminList = await ctx.calendar.findAll(
        tenant.condominiumId,
        listQuery(),
        UserRole.TENANT_ADMIN,
      );
      expect(adminList.meta.total).toBe(2);

      // Resident sees only the PUBLIC event.
      const residentList = await ctx.calendar.findAll(
        tenant.condominiumId,
        listQuery(),
        UserRole.RESIDENT,
      );
      expect(residentList.meta.total).toBe(1);
      expect((residentList.data as Array<{ id: string; visibility: string }>)[0].id).toBe(
        publicEvent.id,
      );

      // findOne mirrors the filter: PRIVATE reads as not-found for a resident.
      await expect(
        ctx.calendar.findOne(tenant.condominiumId, privateEvent.id, UserRole.RESIDENT),
      ).rejects.toThrow(NotFoundException);
      const visible = (await ctx.calendar.findOne(
        tenant.condominiumId,
        publicEvent.id,
        UserRole.RESIDENT,
      )) as { id: string };
      expect(visible.id).toBe(publicEvent.id);
    });
  });
});
