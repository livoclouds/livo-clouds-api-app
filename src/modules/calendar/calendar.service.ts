import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CalendarEventVisibility, EventType, EventStatus } from '@prisma/client';
import { PaginatedResult, UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
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
  ) {}

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
      }),
      this.prisma.calendarEvent.findMany({
        where: recurringWhere,
        include,
        orderBy: { startDate: 'asc' },
      }),
    ]);

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

    await this.prisma.calendarEvent.updateMany({
      where: { id, condominiumId, deletedAt: null },
      data,
    });

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
      afterState: updated,
    });

    return updated;
  }

  async remove(condominiumId: string, userId: string, id: string) {
    const existing = await this.findOne(condominiumId, id, UserRole.ROOT);

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
    });

    return { id };
  }
}
