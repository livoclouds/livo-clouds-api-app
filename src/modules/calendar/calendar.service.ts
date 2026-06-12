import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CalendarEventVisibility, EventType, EventStatus, ReconciliationStatus } from '@prisma/client';
import { PaginatedResult, UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ReconciliationLifecycleService } from '../reconciliation/reconciliation-lifecycle.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';
import { PaidLinkActionDto, UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import {
  validateTerraceMetadata,
  TERRACE_BOOKING_DEFAULTS,
  type TerraceBookingMetadata,
} from './terrace-metadata.validator';
import {
  MAX_TOTAL_OCCURRENCES,
  RecurrenceValidationError,
  expandRecurrence,
  validateRecurrenceRule,
} from './recurrence';
import { assertValidTimezone } from './timezone.util';
import { buildVisibilityFilter, canSeeVisibility } from './visibility.util';
import {
  CALENDAR_TERRACE_CHANGED,
  type CalendarTerraceChangedPayload,
} from './events/calendar-terrace-changed.event';
import {
  CALENDAR_BOOKING_CONFIRMED_EVENT,
  CALENDAR_EVENT_CANCELLED_EVENT,
  CALENDAR_EVENT_CREATED_EVENT,
  type CalendarBookingConfirmedEventPayload,
  type CalendarEventCancelledEventPayload,
  type CalendarEventCreatedEventPayload,
} from './events/calendar-notification-events';
import {
  shouldTriggerReclassifyOnCreate,
  shouldTriggerReclassifyOnDelete,
  shouldTriggerReclassifyOnUpdate,
  toTerraceTriggerSnapshot,
  type TriggerCore,
} from './reclassify/should-trigger-reclassify';

const MAX_CALENDAR_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

function assertRecurrenceAllowed(
  eventType: EventType,
  recurrenceRule: string | null | undefined,
  startDate: Date,
): void {
  if (recurrenceRule == null || recurrenceRule.length === 0) return;
  if (eventType === EventType.TERRACE_BOOKING) {
    throw new BadRequestException('recurrenceTerraceUnsupported');
  }
  try {
    validateRecurrenceRule(recurrenceRule, startDate);
  } catch (err) {
    if (err instanceof RecurrenceValidationError) {
      throw new BadRequestException(err.code);
    }
    throw err;
  }
}

@Injectable()
export class CalendarService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private events: EventEmitter2,
    private reconciliationLifecycle: ReconciliationLifecycleService,
  ) {}

  private readonly logger = new Logger(CalendarService.name);

  private emitTerraceChange(
    trigger: TriggerCore | null,
    action: CalendarTerraceChangedPayload['action'],
  ): void {
    if (!trigger) return;
    const payload: CalendarTerraceChangedPayload = { ...trigger, action };
    this.events.emit(CALENDAR_TERRACE_CHANGED, payload);
  }

  /** Best-effort notification emit — never breaks the calendar write. */
  private emitNotification(event: string, payload: object): void {
    try {
      this.events.emit(event, payload);
    } catch (err) {
      this.logger.warn(`emitNotification(${event}) failed: ${String(err)}`);
    }
  }

  /**
   * CAL-011: cancelling or deleting a terrace booking that still has APPROVED
   * linked transactions would orphan attributed income (the booking disappears
   * from the calendar while the rental stays counted). Force an explicit operator
   * decision instead of silently keeping or dropping the money:
   *   - no action  → 409 PAID_BOOKING_LINKED (the caller must choose)
   *   - KEEP       → leave the approved payment as-is (income retained)
   *   - REOPEN     → reopen each payment back to reconciliation review (the
   *                  guarded reopen also reverts the booking's paymentStatus)
   * Returns the affected transaction ids so the caller can annotate the audit log.
   * A no-op (empty list) when nothing approved is linked.
   */
  private async resolveLinkedApprovedPayments(
    condominiumId: string,
    eventId: string,
    userId: string,
    paidLinkAction: PaidLinkActionDto | undefined,
  ): Promise<string[]> {
    const linked = await this.prisma.transaction.findMany({
      where: {
        condominiumId,
        matchedCalendarEventId: eventId,
        reconciliationStatus: ReconciliationStatus.APPROVED,
      },
      select: { id: true },
    });
    if (linked.length === 0) return [];

    if (!paidLinkAction) {
      throw new ConflictException({
        code: 'PAID_BOOKING_LINKED',
        reason:
          'This terrace booking has an approved payment linked. Choose whether to keep the recorded income or reopen the payment before cancelling.',
        linkedTransactionIds: linked.map((t) => t.id),
      });
    }

    if (paidLinkAction === PaidLinkActionDto.REOPEN) {
      // Reuse the guarded reopen: it asserts state, reverts the booking
      // paymentStatus (other-payer aware), audits, and recomputes summaries.
      for (const t of linked) {
        await this.reconciliationLifecycle.reopenTransaction(condominiumId, t.id, userId);
      }
    }

    return linked.map((t) => t.id);
  }

  async findAll(
    condominiumId: string,
    query: ListCalendarEventsDto,
    role: UserRole = UserRole.ROOT,
  ): Promise<PaginatedResult<unknown>> {
    if (query.type && !Object.values(EventType).includes(query.type as EventType)) {
      throw new BadRequestException(
        `Invalid eventType: "${query.type}". Valid values: ${Object.values(EventType).join(', ')}`,
      );
    }
    if (query.status && !Object.values(EventStatus).includes(query.status as EventStatus)) {
      throw new BadRequestException(
        `Invalid status: "${query.status}". Valid values: ${Object.values(EventStatus).join(', ')}`,
      );
    }

    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);
    if (isNaN(fromDate.getTime())) {
      throw new BadRequestException('Invalid "from" date format. Expected ISO 8601.');
    }
    if (isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid "to" date format. Expected ISO 8601.');
    }
    if (toDate.getTime() < fromDate.getTime()) {
      throw new BadRequestException('"to" must be on or after "from".');
    }
    if (toDate.getTime() - fromDate.getTime() > MAX_CALENDAR_RANGE_MS) {
      throw new BadRequestException('Calendar range cannot exceed 365 days.');
    }

    const baseFilter: Record<string, unknown> = { condominiumId, deletedAt: null };
    if (query.type) baseFilter.eventType = query.type;
    if (query.status) baseFilter.status = query.status;
    const visibilityFilter = buildVisibilityFilter(role);
    if (visibilityFilter.visibility) baseFilter.visibility = visibilityFilter.visibility;

    const singleWhere: Record<string, unknown> = {
      ...baseFilter,
      recurrenceRule: null,
      AND: [{ startDate: { lt: toDate } }, { endDate: { gt: fromDate } }],
    };

    // A1 (Phase 4): the recurring-parent read is intentionally left unbounded.
    // A series' end lives inside the RRULE string (UNTIL/COUNT), not in a queryable
    // column, so it has only an upper bound on startDate. Applying `take` (ordered by
    // startDate asc) could silently drop a still-active series whose first occurrence
    // is old but which recurs into the requested range — producing missing occurrences.
    // A lower bound on startDate is unsafe for the same reason. Bounding this at the DB
    // level requires a denormalized, indexed recurrence-end column (deferred; tracked
    // as a follow-up). The in-memory MAX_TOTAL_OCCURRENCES guard below caps the blow-up.
    const recurringWhere: Record<string, unknown> = {
      ...baseFilter,
      recurrenceRule: { not: null },
      startDate: { lt: toDate },
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 500;
    const skip = (page - 1) * limit;

    const include = {
      resident: { select: { id: true, firstName: true, lastName: true, unitNumber: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      updatedBy: { select: { id: true, firstName: true, lastName: true } },
    };

    const [singles, recurringParents] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: singleWhere,
        include,
        orderBy: { startDate: 'asc' },
        // A1 (Phase 4): bound the single-event read. Each single row maps 1:1 to an
        // output item, so capping at the occurrence ceiling is safe. The `+ 1` lets us
        // detect overflow below without silently truncating (which would make meta.total
        // inaccurate). The existing overlap filter already bounds singles to the range.
        take: MAX_TOTAL_OCCURRENCES + 1,
      }),
      this.prisma.calendarEvent.findMany({
        where: recurringWhere,
        include,
        orderBy: { startDate: 'asc' },
      }),
    ]);

    // A1 (Phase 4): fail loudly when single events alone exceed the ceiling. The
    // recurrence guard below only runs while expanding recurring parents, so a
    // condominium with no recurring events previously had an effectively unbounded
    // single-event read. Throwing here (rather than truncating) keeps meta.total exact.
    if (singles.length > MAX_TOTAL_OCCURRENCES) {
      throw new BadRequestException('calendarTooMany');
    }

    const expandedOccurrences: Record<string, unknown>[] = [];
    for (const parent of recurringParents) {
      const occurrences = expandRecurrence(
        {
          id: parent.id,
          startDate: parent.startDate,
          endDate: parent.endDate,
          recurrenceRule: parent.recurrenceRule,
        },
        fromDate,
        toDate,
      );
      for (const occ of occurrences) {
        if (expandedOccurrences.length + singles.length >= MAX_TOTAL_OCCURRENCES) {
          throw new BadRequestException('recurrenceTooMany');
        }
        expandedOccurrences.push({
          ...parent,
          id: occ.occurrenceId,
          startDate: occ.occurrenceStart,
          endDate: occ.occurrenceEnd,
          originalEventId: parent.id,
          isOccurrence: true,
        });
      }
    }

    const merged = [...singles, ...expandedOccurrences];
    merged.sort((a, b) => {
      const aStart = (a as { startDate: Date }).startDate.getTime();
      const bStart = (b as { startDate: Date }).startDate.getTime();
      if (aStart !== bStart) return aStart - bStart;
      const aId = (a as { id: string }).id;
      const bId = (b as { id: string }).id;
      return aId.localeCompare(bId);
    });

    const total = merged.length;
    const data = merged.slice(skip, skip + limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(condominiumId: string, id: string, role: UserRole = UserRole.ROOT) {
    const event = await this.prisma.calendarEvent.findFirst({
      where: { id, condominiumId, deletedAt: null },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, unitNumber: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!event) {
      throw new NotFoundException('Calendar event not found');
    }

    if (!canSeeVisibility(role, event.visibility)) {
      throw new NotFoundException('Calendar event not found');
    }

    return event;
  }

  async create(condominiumId: string, userId: string, dto: CreateCalendarEventDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (end <= start) {
      throw new BadRequestException('endDate must be after startDate');
    }

    let resolvedMetadata: TerraceBookingMetadata | undefined;
    if (dto.eventType === EventType.TERRACE_BOOKING) {
      const cs = await this.prisma.condominiumSettings.findUnique({
        where: { condominiumId },
        select: { terraceBookingEnabled: true, terraceRentalAmount: true, terraceSecurityDepositAmount: true },
      });
      if (cs !== null && !cs.terraceBookingEnabled) {
        throw new BadRequestException('Terrace bookings are disabled for this condominium');
      }
      let defaults = TERRACE_BOOKING_DEFAULTS;
      if (!dto.metadata && cs) {
        defaults = {
          ...TERRACE_BOOKING_DEFAULTS,
          terraceRentalAmount: Number(cs.terraceRentalAmount),
          securityDepositAmount: Number(cs.terraceSecurityDepositAmount),
        };
      }
      const result = validateTerraceMetadata(dto.metadata ?? defaults);
      if (!result.valid) throw new BadRequestException(result.error);
      resolvedMetadata = result.data;
    }
    // Non-terrace events: metadata is always stripped — resolvedMetadata stays undefined.

    if (dto.residentId) {
      const resident = await this.prisma.resident.findFirst({
        where: { id: dto.residentId, condominiumId, deletedAt: null },
      });
      if (!resident) throw new NotFoundException('Resident not found');
    }

    assertRecurrenceAllowed(dto.eventType, dto.recurrenceRule, start);
    assertValidTimezone(dto.timezone);

    if (dto.eventType === EventType.TERRACE_BOOKING) {
      const conflict = await this.prisma.calendarEvent.findFirst({
        where: {
          condominiumId,
          eventType: EventType.TERRACE_BOOKING,
          status: { not: EventStatus.CANCELLED },
          deletedAt: null,
          AND: [{ startDate: { lt: end } }, { endDate: { gt: start } }],
        },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictException(
          'Terrace already booked for the requested time slot',
        );
      }
    }

    const event = await this.prisma.calendarEvent.create({
      data: {
        condominiumId,
        createdById: userId,
        title: dto.title,
        description: dto.description,
        eventType: dto.eventType,
        startDate: start,
        endDate: end,
        allDay: dto.allDay ?? false,
        location: dto.location,
        unitNumber: dto.unitNumber,
        residentId: dto.residentId,
        notes: dto.notes,
        recurrenceRule: dto.recurrenceRule ?? null,
        parentEventId: dto.parentEventId ?? null,
        timezone: dto.timezone ?? null,
        visibility: (dto.visibility as CalendarEventVisibility | undefined) ?? CalendarEventVisibility.PUBLIC,
        ...(resolvedMetadata !== undefined && { metadata: resolvedMetadata as unknown as object }),
      },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, unitNumber: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.audit.log({
      condominiumId,
      userId,
      action: 'CALENDAR_EVENT_CREATED',
      actionCategory: 'CREATE',
      module: 'calendar',
      entityType: 'CalendarEvent',
      entityId: event.id,
      afterState: event,
    });

    this.emitTerraceChange(
      shouldTriggerReclassifyOnCreate(condominiumId, toTerraceTriggerSnapshot(event), event.id),
      'create',
    );

    this.emitNotification(CALENDAR_EVENT_CREATED_EVENT, {
      condominiumId,
      eventId: event.id,
      title: event.title,
      startsAt: event.startDate.toISOString(),
      actorUserId: userId,
    } satisfies CalendarEventCreatedEventPayload);

    return event;
  }

  async update(condominiumId: string, userId: string, id: string, dto: UpdateCalendarEventDto) {
    // Update is gated to ROOT/TENANT_ADMIN at the controller, so passing ROOT here
    // is correct: the existence/visibility check should never hide a row from an
    // admin during a write operation.
    const existing = await this.findOne(condominiumId, id, UserRole.ROOT);

    const start = new Date(dto.startDate ?? existing.startDate);
    const end = new Date(dto.endDate ?? existing.endDate);

    if (end <= start) {
      throw new BadRequestException('endDate must be after startDate');
    }

    if (dto.residentId && dto.residentId !== existing.residentId) {
      const resident = await this.prisma.resident.findFirst({
        where: { id: dto.residentId, condominiumId, deletedAt: null },
      });
      if (!resident) throw new NotFoundException('Resident not found');
    }

    const effectiveType = dto.eventType ?? existing.eventType;
    const effectiveStatus = dto.status ?? existing.status;
    const effectiveRecurrence =
      dto.recurrenceRule !== undefined ? dto.recurrenceRule : existing.recurrenceRule;
    assertRecurrenceAllowed(effectiveType, effectiveRecurrence, start);
    if (
      dto.timezone !== undefined &&
      dto.timezone !== null &&
      dto.timezone.length > 0
    ) {
      assertValidTimezone(dto.timezone);
    }

    if (
      effectiveType === EventType.TERRACE_BOOKING &&
      effectiveStatus !== EventStatus.CANCELLED
    ) {
      const conflict = await this.prisma.calendarEvent.findFirst({
        where: {
          condominiumId,
          id: { not: id },
          eventType: EventType.TERRACE_BOOKING,
          status: { not: EventStatus.CANCELLED },
          deletedAt: null,
          AND: [{ startDate: { lt: end } }, { endDate: { gt: start } }],
        },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictException(
          'Terrace already booked for the requested time slot',
        );
      }
    }

    // CAL-011: cancelling a terrace booking that still has an approved payment
    // linked needs an explicit keep/reopen decision before any state is written.
    // Runs only on the PENDING/CONFIRMED → CANCELLED edge so an ordinary edit of
    // an already-cancelled (or never-paid) booking is unaffected.
    let reopenedPaymentIds: string[] = [];
    const cancellingTerrace =
      existing.eventType === EventType.TERRACE_BOOKING &&
      effectiveStatus === EventStatus.CANCELLED &&
      existing.status !== EventStatus.CANCELLED;
    if (cancellingTerrace) {
      reopenedPaymentIds = await this.resolveLinkedApprovedPayments(
        condominiumId,
        id,
        userId,
        dto.paidLinkAction,
      );
    }

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.eventType !== undefined) data.eventType = dto.eventType;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.allDay !== undefined) data.allDay = dto.allDay;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.unitNumber !== undefined) data.unitNumber = dto.unitNumber;
    if (dto.residentId !== undefined) data.residentId = dto.residentId;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.recurrenceRule !== undefined) {
      data.recurrenceRule = dto.recurrenceRule == null || dto.recurrenceRule.length === 0
        ? null
        : dto.recurrenceRule;
    }
    if (dto.parentEventId !== undefined) data.parentEventId = dto.parentEventId;
    if (dto.visibility !== undefined) {
      data.visibility = dto.visibility as CalendarEventVisibility;
    }
    if (dto.timezone !== undefined) {
      data.timezone =
        dto.timezone === null || (typeof dto.timezone === 'string' && dto.timezone.length === 0)
          ? null
          : dto.timezone;
    }
    data.updatedById = userId;

    if (dto.metadata !== undefined) {
      if (effectiveType === EventType.TERRACE_BOOKING) {
        if (existing.eventType !== EventType.TERRACE_BOOKING) {
          // Changing from a non-terrace type to terrace with explicit metadata: check enabled.
          const cs = await this.prisma.condominiumSettings.findUnique({
            where: { condominiumId },
            select: { terraceBookingEnabled: true },
          });
          if (cs !== null && !cs.terraceBookingEnabled) {
            throw new BadRequestException('Terrace bookings are disabled for this condominium');
          }
        }
        const result = validateTerraceMetadata(dto.metadata);
        if (!result.valid) throw new BadRequestException(result.error);
        data.metadata = result.data as unknown as object;
      } else {
        // metadata provided for a non-terrace event: strip it to avoid stale data
        data.metadata = null;
      }
    } else if (dto.eventType !== undefined) {
      const changingToTerrace =
        dto.eventType === EventType.TERRACE_BOOKING &&
        existing.eventType !== EventType.TERRACE_BOOKING;
      const changingFromTerrace =
        existing.eventType === EventType.TERRACE_BOOKING &&
        dto.eventType !== EventType.TERRACE_BOOKING;
      if (changingToTerrace) {
        // No metadata provided when switching to TERRACE_BOOKING: check enabled and apply defaults.
        const cs = await this.prisma.condominiumSettings.findUnique({
          where: { condominiumId },
          select: { terraceBookingEnabled: true, terraceRentalAmount: true, terraceSecurityDepositAmount: true },
        });
        if (cs !== null && !cs.terraceBookingEnabled) {
          throw new BadRequestException('Terrace bookings are disabled for this condominium');
        }
        const defaults: TerraceBookingMetadata = cs
          ? {
              ...TERRACE_BOOKING_DEFAULTS,
              terraceRentalAmount: Number(cs.terraceRentalAmount),
              securityDepositAmount: Number(cs.terraceSecurityDepositAmount),
            }
          : TERRACE_BOOKING_DEFAULTS;
        data.metadata = defaults as unknown as object;
      } else if (changingFromTerrace) {
        // Switching away from TERRACE_BOOKING: clear stale terrace metadata.
        data.metadata = null;
      }
    }

    // CAL-006: when the client sends the version it edited against, gate the write
    // on the event's updatedAt. A zero-row update then means the event changed
    // under the open modal (e.g. a reconciliation flipped the booking PAID) — a
    // blind save would silently revert paymentStatus, so reject with the same
    // STALE_OVERRIDE contract transactions already use. Without expectedUpdatedAt
    // the behavior is unchanged (last-write-wins, the pre-Phase-3 default).
    const updateResult = await this.prisma.calendarEvent.updateMany({
      where: {
        id,
        condominiumId,
        deletedAt: null,
        ...(dto.expectedUpdatedAt
          ? { updatedAt: new Date(dto.expectedUpdatedAt) }
          : {}),
      },
      data,
    });
    if (dto.expectedUpdatedAt && updateResult.count === 0) {
      throw new ConflictException({
        code: 'STALE_OVERRIDE',
        reason: 'Calendar event was modified by another user. Refresh and try again.',
      });
    }

    const updated = await this.findOne(condominiumId, id, UserRole.ROOT);

    await this.audit.log({
      condominiumId,
      userId,
      action: 'CALENDAR_EVENT_UPDATED',
      actionCategory: 'UPDATE',
      module: 'calendar',
      entityType: 'CalendarEvent',
      entityId: id,
      beforeState: existing,
      // CAL-011: record the operator's keep/reopen decision on the audited cancel
      // so the income disposition is traceable.
      afterState: cancellingTerrace
        ? {
            ...updated,
            paidLinkAction: dto.paidLinkAction ?? null,
            reopenedPaymentIds,
          }
        : updated,
    });

    this.emitTerraceChange(
      shouldTriggerReclassifyOnUpdate(
        condominiumId,
        toTerraceTriggerSnapshot(existing),
        toTerraceTriggerSnapshot(updated),
        id,
      ),
      'update',
    );

    // A terrace booking that transitions into CONFIRMED is a booking
    // confirmation — emit once, only on the PENDING/CANCELLED → CONFIRMED edge.
    if (
      updated.eventType === EventType.TERRACE_BOOKING &&
      updated.status === EventStatus.CONFIRMED &&
      existing.status !== EventStatus.CONFIRMED
    ) {
      this.emitNotification(CALENDAR_BOOKING_CONFIRMED_EVENT, {
        condominiumId,
        eventId: updated.id,
        terraceId: null,
        residentId: updated.residentId,
        startsAt: updated.startDate.toISOString(),
        actorUserId: userId,
      } satisfies CalendarBookingConfirmedEventPayload);
    }

    return updated;
  }

  async remove(
    condominiumId: string,
    userId: string,
    id: string,
    paidLinkAction?: PaidLinkActionDto,
  ) {
    const existing = await this.findOne(condominiumId, id, UserRole.ROOT);

    // CAL-011: deleting a terrace booking with an approved payment still linked
    // needs an explicit keep/reopen decision (same contract as cancel) before the
    // row is soft-deleted and the income would silently orphan.
    let reopenedPaymentIds: string[] = [];
    if (existing.eventType === EventType.TERRACE_BOOKING) {
      reopenedPaymentIds = await this.resolveLinkedApprovedPayments(
        condominiumId,
        id,
        userId,
        paidLinkAction,
      );
    }

    await this.prisma.calendarEvent.updateMany({
      where: { id, condominiumId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      condominiumId,
      userId,
      action: 'CALENDAR_EVENT_DELETED',
      actionCategory: 'DELETE',
      module: 'calendar',
      entityType: 'CalendarEvent',
      entityId: id,
      beforeState: existing,
      // CAL-011: trace the operator's keep/reopen decision on a paid-linked delete.
      ...(existing.eventType === EventType.TERRACE_BOOKING
        ? { afterState: { paidLinkAction: paidLinkAction ?? null, reopenedPaymentIds } }
        : {}),
    });

    this.emitTerraceChange(
      shouldTriggerReclassifyOnDelete(condominiumId, toTerraceTriggerSnapshot(existing), id),
      'delete',
    );

    this.emitNotification(CALENDAR_EVENT_CANCELLED_EVENT, {
      condominiumId,
      eventId: existing.id,
      title: existing.title,
      actorUserId: userId,
    } satisfies CalendarEventCancelledEventPayload);

    return { id };
  }
}
