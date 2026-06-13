import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { EventStatus, EventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SOFT_DELETE_RETENTION_MS, STALE_PENDING_GRACE_MS } from './calendar.constants';
import {
  CALENDAR_TERRACE_CHANGED,
  type CalendarTerraceChangedPayload,
} from './events/calendar-terrace-changed.event';
import {
  shouldTriggerReclassifyOnUpdate,
  toTerraceTriggerSnapshot,
} from './reclassify/should-trigger-reclassify';

// audit_logs.userId is a REQUIRED FK to users — a literal 'system' actor would
// FK-fail. Cron-driven audit rows are attributed to the event's creator
// (createdById) with `triggeredBy: 'system-calendar-maintenance'` in afterState
// marking the real actor (CAL-039 pattern, mirrors imports-maintenance.cron.ts).
const SYSTEM_TRIGGER = 'system-calendar-maintenance';

export interface CalendarMaintenanceSweepResult {
  pendingExpired: number;
  softDeletedPurged: number;
}

/**
 * CAL-043 — calendar maintenance cron. Two idempotent passes daily:
 *
 *  1. **Stale-PENDING expiry** — a terrace booking that is still PENDING after
 *     its event date has passed was never confirmed/paid; it only keeps holding
 *     the slot. Such bookings are auto-CANCELLED and a re-match is triggered so
 *     reconciliation drops them as candidates. (The tenant-configurable hold
 *     window for *future* PENDING bookings is a deferred follow-up — see backlog.)
 *  2. **Soft-delete retention purge** — leaf events soft-deleted longer than
 *     `SOFT_DELETE_RETENTION_MS` are hard-deleted to reclaim storage. Only
 *     childless events are purged so a Cascade FK (CAL-023) can never take a
 *     live child down with a removed parent.
 *
 * Every system action is audited via the FK-safe attribution pattern. A failed
 * run is logged and swallowed so the scheduler stays healthy; one bad row never
 * aborts the rest of the sweep.
 */
@Injectable()
export class CalendarMaintenanceCron {
  private readonly logger = new Logger(CalendarMaintenanceCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  @Cron('0 5 * * *', {
    name: 'calendar-maintenance',
    timeZone: 'America/Mexico_City',
  })
  async scheduledSweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`calendar-maintenance: sweep failed: ${String(err)}`);
    }
  }

  async sweep(now: Date = new Date()): Promise<CalendarMaintenanceSweepResult> {
    const pendingExpired = await this.expireStalePending(now);
    const softDeletedPurged = await this.purgeSoftDeleted(now);

    this.logger.log(
      `calendar-maintenance: sweep complete — pendingExpired=${pendingExpired} softDeletedPurged=${softDeletedPurged}`,
    );
    return { pendingExpired, softDeletedPurged };
  }

  // --- Pass 1: expire PENDING terrace bookings whose event date has passed ---
  private async expireStalePending(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_PENDING_GRACE_MS);
    const stale = await this.prisma.calendarEvent.findMany({
      where: {
        eventType: EventType.TERRACE_BOOKING,
        status: EventStatus.PENDING,
        deletedAt: null,
        startDate: { lt: cutoff },
      },
      select: {
        id: true,
        condominiumId: true,
        createdById: true,
        startDate: true,
        residentId: true,
        unitNumber: true,
        metadata: true,
        eventType: true,
      },
    });

    let expired = 0;
    for (const event of stale) {
      try {
        // Conditional update — never clobber a booking a user just confirmed.
        const result = await this.prisma.calendarEvent.updateMany({
          where: { id: event.id, status: EventStatus.PENDING, deletedAt: null },
          data: { status: EventStatus.CANCELLED },
        });
        if (result.count === 0) continue;

        await this.audit.log({
          condominiumId: event.condominiumId,
          userId: event.createdById,
          action: 'CALENDAR_EVENT_EXPIRED',
          actionCategory: 'UPDATE',
          module: 'calendar',
          entityType: 'CalendarEvent',
          entityId: event.id,
          result: 'WARNING',
          description:
            'Stale PENDING terrace booking auto-cancelled by maintenance (event date passed, never confirmed)',
          afterState: {
            triggeredBy: SYSTEM_TRIGGER,
            previousStatus: EventStatus.PENDING,
            status: EventStatus.CANCELLED,
            startDate: event.startDate,
          },
        });

        // Re-match so reconciliation drops the now-cancelled booking as a candidate.
        this.emitExpiryReclassify(event);
        expired += 1;
      } catch (err) {
        this.logger.error(
          `calendar-maintenance: expiry failed for event=${event.id}: ${String(err)}`,
        );
      }
    }
    return expired;
  }

  // --- Pass 2: hard-delete long-soft-deleted leaf events ---
  private async purgeSoftDeleted(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
    const purgeable = await this.prisma.calendarEvent.findMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
        // Childless only — a Cascade FK (CAL-023) means purging a recurring
        // parent could take live children with it. Leave parents for a future
        // recurrence-aware purge.
        childEvents: { none: {} },
      },
      select: { id: true, condominiumId: true, createdById: true, updatedById: true },
    });

    let purged = 0;
    for (const event of purgeable) {
      try {
        const result = await this.prisma.calendarEvent.deleteMany({
          where: { id: event.id, deletedAt: { not: null, lt: cutoff } },
        });
        if (result.count === 0) continue;

        await this.audit.log({
          condominiumId: event.condominiumId,
          userId: event.updatedById ?? event.createdById,
          action: 'CALENDAR_EVENT_PURGED',
          actionCategory: 'DELETE',
          module: 'calendar',
          entityType: 'CalendarEvent',
          entityId: event.id,
          result: 'SUCCESS',
          description:
            'Soft-deleted calendar event hard-deleted by maintenance after the retention window',
          afterState: { triggeredBy: SYSTEM_TRIGGER },
        });
        purged += 1;
      } catch (err) {
        this.logger.error(
          `calendar-maintenance: purge failed for event=${event.id}: ${String(err)}`,
        );
      }
    }
    return purged;
  }

  private emitExpiryReclassify(event: {
    id: string;
    condominiumId: string;
    createdById: string;
    startDate: Date;
    residentId: string | null;
    unitNumber: string | null;
    metadata: unknown;
    eventType: EventType;
  }): void {
    const before = toTerraceTriggerSnapshot({
      eventType: event.eventType,
      status: EventStatus.PENDING,
      startDate: event.startDate,
      residentId: event.residentId,
      unitNumber: event.unitNumber,
      metadata: event.metadata,
    });
    const after = toTerraceTriggerSnapshot({
      eventType: event.eventType,
      status: EventStatus.CANCELLED,
      startDate: event.startDate,
      residentId: event.residentId,
      unitNumber: event.unitNumber,
      metadata: event.metadata,
    });
    const trigger = shouldTriggerReclassifyOnUpdate(
      event.condominiumId,
      before,
      after,
      event.id,
    );
    if (!trigger) return;
    const payload: CalendarTerraceChangedPayload = {
      ...trigger,
      action: 'update',
      actorUserId: event.createdById,
    };
    this.events.emit(CALENDAR_TERRACE_CHANGED, payload);
  }
}
