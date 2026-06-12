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
import { EventStatus, EventType, FlowType, type Prisma } from '@prisma/client';

import {
  CreateCalendarEventDto,
  EventTypeDto,
  CalendarEventVisibilityDto,
} from '../../src/modules/calendar/dto/create-calendar-event.dto';
import type { ListCalendarEventsDto } from '../../src/modules/calendar/dto/list-calendar-events.dto';
import {
  PaidLinkActionDto,
  type UpdateCalendarEventDto,
} from '../../src/modules/calendar/dto/update-calendar-event.dto';
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

/**
 * Seeds an APPROVED income transaction linked to a terrace booking (CAL-011
 * fixture). Transaction.importBatchId is NOT NULL, so a bankProfile + importBatch
 * are created alongside it. Returns the transaction id.
 */
async function seedApprovedLinkedPayment(
  ctx: PipelineContext,
  tenant: SeededTenant,
  bookingId: string,
): Promise<string> {
  const bankProfile = await ctx.prisma.bankProfile.create({
    data: { condominiumId: tenant.condominiumId, name: `Generic-${Date.now()}`, excelAliases: {} },
  });
  const batch = await ctx.prisma.importBatch.create({
    data: {
      condominiumId: tenant.condominiumId,
      importedById: tenant.userId,
      bankProfileId: bankProfile.id,
      fileName: 'estado.xlsx',
      fileType: 'xlsx',
      fileSizeBytes: 1024,
      fileHash: `hash-${bookingId}`,
    },
  });
  const tx = await ctx.prisma.transaction.create({
    data: {
      condominiumId: tenant.condominiumId,
      importBatchId: batch.id,
      transactionDate: new Date('2026-06-12T00:00:00.000Z'),
      description: 'PAGO RESERVA TERRAZA',
      credits: 1500,
      balance: 1500,
      flowType: FlowType.INCOME,
      matchedCalendarEventId: bookingId,
      matchSource: 'AUTO_TERRACE_BOOKING',
      reconciliationStatus: 'APPROVED',
      reconciledById: tenant.userId,
      reconciledAt: new Date('2026-06-12T01:00:00.000Z'),
    },
    select: { id: true },
  });
  return tx.id;
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

    it("create in tenant A rejects a parentEventId belonging to tenant B (CAL-023)", async () => {
      const foreign = (await ctx.calendar.create(
        other.condominiumId,
        other.userId,
        eventDto({ title: 'Foreign parent' }),
      )) as { id: string };

      await expect(
        ctx.calendar.create(
          tenant.condominiumId,
          tenant.userId,
          eventDto({ parentEventId: foreign.id }),
        ),
      ).rejects.toThrow('Parent calendar event not found');

      // Nothing was written in tenant A.
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

      // Phase 4: visibility derives from effective permissions, not the role.
      const managePerms: ReadonlySet<string> = new Set(['calendar.read', 'calendar.manage']);
      const residentPerms: ReadonlySet<string> = new Set(['calendar.read']);

      // A manager sees both.
      const adminList = await ctx.calendar.findAll(
        tenant.condominiumId,
        listQuery(),
        managePerms,
      );
      expect(adminList.meta.total).toBe(2);

      // Resident sees only the PUBLIC event.
      const residentList = await ctx.calendar.findAll(
        tenant.condominiumId,
        listQuery(),
        residentPerms,
      );
      expect(residentList.meta.total).toBe(1);
      expect((residentList.data as Array<{ id: string; visibility: string }>)[0].id).toBe(
        publicEvent.id,
      );

      // findOne mirrors the filter: PRIVATE reads as not-found for a resident.
      await expect(
        ctx.calendar.findOne(tenant.condominiumId, privateEvent.id, residentPerms),
      ).rejects.toThrow(NotFoundException);
      const visible = (await ctx.calendar.findOne(
        tenant.condominiumId,
        publicEvent.id,
        residentPerms,
      )) as { id: string };
      expect(visible.id).toBe(publicEvent.id);
    });
  });

  // ── CAL-006: optimistic lock on update ───────────────────────────────────────

  describe('optimistic lock (CAL-006)', () => {
    it('rejects a stale update with 409 STALE_OVERRIDE when expectedUpdatedAt no longer matches', async () => {
      const created = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto({ title: 'Original' }),
      )) as { id: string };

      // A version the modal never saw (an hour in the past) → conflict.
      const staleVersion = '2020-01-01T00:00:00.000Z';
      await expect(
        ctx.calendar.update(tenant.condominiumId, tenant.userId, created.id, {
          title: 'Stale save',
          expectedUpdatedAt: staleVersion,
        } as UpdateCalendarEventDto),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'STALE_OVERRIDE' }),
      });

      // The stale save did not land.
      const row = (await ctx.calendar.findOne(tenant.condominiumId, created.id)) as {
        title: string;
      };
      expect(row.title).toBe('Original');
    });

    it('accepts an update carrying the current updatedAt', async () => {
      const created = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto({ title: 'Original' }),
      )) as { id: string; updatedAt: Date | string };

      const updated = (await ctx.calendar.update(
        tenant.condominiumId,
        tenant.userId,
        created.id,
        {
          title: 'Fresh save',
          expectedUpdatedAt: new Date(created.updatedAt).toISOString(),
        } as UpdateCalendarEventDto,
      )) as { title: string };
      expect(updated.title).toBe('Fresh save');
    });
  });

  // ── CAL-011: operator decision on cancel/delete of a paid booking ────────────

  describe('paid booking link decision (CAL-011)', () => {
    async function seedPaidBooking(): Promise<{ bookingId: string; txId: string }> {
      const booking = (await ctx.calendar.create(
        tenant.condominiumId,
        tenant.userId,
        eventDto({
          title: 'Terraza pagada',
          eventType: EventTypeDto.TERRACE_BOOKING,
          startDate: '2026-06-20T18:00:00.000Z',
          endDate: '2026-06-20T22:00:00.000Z',
          metadata: terraceMetadata({ paymentStatus: 'PAID' }),
        }),
      )) as { id: string };
      const txId = await seedApprovedLinkedPayment(ctx, tenant, booking.id);
      return { bookingId: booking.id, txId };
    }

    it('deleting a paid-linked booking with no action returns 409 PAID_BOOKING_LINKED', async () => {
      const { bookingId, txId } = await seedPaidBooking();

      await expect(
        ctx.calendar.remove(tenant.condominiumId, tenant.userId, bookingId),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'PAID_BOOKING_LINKED',
          linkedTransactionIds: [txId],
        }),
      });

      // Nothing was deleted; the payment is untouched.
      const row = await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: bookingId } });
      expect(row.deletedAt).toBeNull();
      const tx = await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: txId } });
      expect(tx.reconciliationStatus).toBe('APPROVED');
    });

    it('KEEP deletes the booking and retains the approved income', async () => {
      const { bookingId, txId } = await seedPaidBooking();

      await ctx.calendar.remove(
        tenant.condominiumId,
        tenant.userId,
        bookingId,
        PaidLinkActionDto.KEEP,
      );

      const row = await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: bookingId } });
      expect(row.deletedAt).not.toBeNull();
      // Income retained: the transaction stays APPROVED and linked.
      const tx = await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: txId } });
      expect(tx.reconciliationStatus).toBe('APPROVED');
    });

    it('REOPEN reopens the linked payment back to reconciliation review before deleting', async () => {
      const { bookingId, txId } = await seedPaidBooking();

      await ctx.calendar.remove(
        tenant.condominiumId,
        tenant.userId,
        bookingId,
        PaidLinkActionDto.REOPEN,
      );

      const row = await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: bookingId } });
      expect(row.deletedAt).not.toBeNull();
      // The payment is back in review (PENDING) and the booking's paymentStatus reverted.
      const tx = await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: txId } });
      expect(tx.reconciliationStatus).toBe('PENDING');
      const meta = row.metadata as { paymentStatus: string };
      expect(meta.paymentStatus).toBe('PENDING');
    });

    it('cancelling a paid-linked booking via update follows the same contract', async () => {
      const { bookingId, txId } = await seedPaidBooking();

      // No action → conflict.
      await expect(
        ctx.calendar.update(tenant.condominiumId, tenant.userId, bookingId, {
          status: 'CANCELLED',
        } as UpdateCalendarEventDto),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PAID_BOOKING_LINKED' }),
      });

      // KEEP → cancel proceeds, income retained.
      const updated = (await ctx.calendar.update(
        tenant.condominiumId,
        tenant.userId,
        bookingId,
        { status: 'CANCELLED', paidLinkAction: PaidLinkActionDto.KEEP } as UpdateCalendarEventDto,
      )) as { status: string };
      expect(updated.status).toBe('CANCELLED');
      const tx = await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: txId } });
      expect(tx.reconciliationStatus).toBe('APPROVED');
    });
  });
});
