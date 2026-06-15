import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { EventStatus, EventType, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { withTryAdvisoryXactLock } from '../../common/utils/advisory-lock.util';
import { AuditService } from '../audit/audit.service';
import { SettingsCacheService } from '../settings/settings-cache.service';
import {
  CALENDAR_MAINTENANCE_LOCK_KEY,
  CALENDAR_MAINTENANCE_LOCK_NAMESPACE,
  CALENDAR_MAINTENANCE_LOCK_TIMEOUT_MS,
  SOFT_DELETE_RETENTION_MS,
  STALE_PENDING_GRACE_MS,
} from './calendar.constants';
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

const HOUR_MS = 60 * 60 * 1000;

// CAL-064 — why a PENDING terrace booking was auto-released, recorded in the audit
// trail so an operator can tell a past-date expiry apart from a tenant-configured
// hold-window release.
type ExpiryReason = 'event-date-passed' | 'hold-window-exceeded';

export interface CalendarMaintenanceSweepResult {
  pendingExpired: number;
  softDeletedPurged: number;
}

/**
 * CAL-043 — calendar maintenance cron. Two idempotent passes daily:
 *
 *  1. **Stale-PENDING expiry** — a terrace booking that is still PENDING is
 *     auto-CANCELLED, and a re-match is triggered so reconciliation drops it as a
 *     candidate, when EITHER (a) its event date has passed (never confirmed/paid —
 *     it only keeps holding the slot), OR (b) CAL-064: the tenant configured a
 *     `pendingHoldWindowHours` > 0 and the booking has been held, unpaid, past that
 *     window measured from `createdAt` — this releases a *future* slot reserved
 *     weeks out and never paid. With the default `pendingHoldWindowHours = 0` only
 *     the past-date branch fires, identical to the pre-CAL-064 behaviour.
 *  2. **Soft-delete retention purge** — events soft-deleted longer than
 *     `SOFT_DELETE_RETENTION_MS` are hard-deleted to reclaim storage. Two guards
 *     keep the delete safe: a parent with any LIVE child is skipped so a Cascade
 *     FK (CAL-023) can't take a live child down with it (CAL-071 — soft-deleted
 *     children no longer block the parent); and a booking still referenced by a
 *     matched transaction is skipped because that FK is RESTRICT, so deleting it
 *     would throw and re-error every sweep (CAL-057).
 *
 * The scheduled entry point holds a single global advisory lock so that, on a
 * horizontally-scaled deployment, only one replica runs the sweep per tick
 * (CAL-059). Every system action is audited via the FK-safe attribution
 * pattern. A failed run is logged and swallowed so the scheduler stays healthy;
 * one bad row never aborts the rest of the sweep.
 */
@Injectable()
export class CalendarMaintenanceCron {
  private readonly logger = new Logger(CalendarMaintenanceCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    // CAL-064 — read per-tenant settings (the PENDING hold window) without an
    // extra DB round-trip per row; the cache is keyed by condominiumId and shared
    // with the settings page / classification.
    private readonly settingsCache: SettingsCacheService,
  ) {}

  @Cron('0 5 * * *', {
    name: 'calendar-maintenance',
    timeZone: 'America/Mexico_City',
  })
  async scheduledSweep(): Promise<void> {
    try {
      // CAL-059 — leadership: only the replica that wins the advisory lock runs
      // the sweep; the rest step aside (no duplicate audit rows / engine load).
      // The lock is held for the sweep's duration and auto-releases at txn end.
      const outcome = await withTryAdvisoryXactLock(
        this.prisma,
        Prisma.sql`hashtext(${CALENDAR_MAINTENANCE_LOCK_NAMESPACE})`,
        Prisma.sql`hashtext(${CALENDAR_MAINTENANCE_LOCK_KEY})`,
        () => this.sweep(),
        { timeoutMs: CALENDAR_MAINTENANCE_LOCK_TIMEOUT_MS },
      );
      if (!outcome.acquired) {
        this.logger.log(
          'calendar-maintenance: another replica holds the maintenance lock — skipping this tick',
        );
      }
    } catch (err) {
      this.logger.error(`calendar-maintenance: sweep failed: ${String(err)}`);
      // CAL-060 — the cron runs outside any HTTP request, so the Sentry
      // exception filter never sees a sweep failure. Capture it explicitly so a
      // nightly sweep that fails every run raises an alertable signal instead of
      // dying silently in logs (parity with the reclassify service). No-op until
      // SENTRY_DSN is set.
      Sentry.captureException(err, {
        extra: { stage: 'calendar-maintenance', phase: 'sweep' },
      });
    }
  }

  async sweep(now: Date = new Date()): Promise<CalendarMaintenanceSweepResult> {
    const pendingExpired = await this.expireStalePending(now);
    const softDeletedPurged = await this.purgeSoftDeleted(now);

    this.logger.log(
      `calendar-maintenance: sweep complete — pendingExpired=${pendingExpired} softDeletedPurged=${softDeletedPurged}`,
    );
    // CAL-060 — machine-parseable metric line with stable key=value dimensions
    // so the sweep counts are dashboardable/alertable (mirrors the reclassify
    // service's `succeeded=/failed=/requeued=` structured line). Kept separate
    // from the human log above so log-based metrics can match on a stable prefix.
    this.logger.log(
      `metric calendar_maintenance_sweep pendingExpired=${pendingExpired} softDeletedPurged=${softDeletedPurged}`,
    );
    return { pendingExpired, softDeletedPurged };
  }

  // --- Pass 1: expire stale PENDING terrace bookings ---
  // A booking is released when its event date has passed (always on, grace=0) OR,
  // per CAL-064, when the tenant configured a hold window and the booking has been
  // held unpaid past it (measured from createdAt). Because the hold window is
  // per-tenant, we can't express the createdAt cutoff in one SQL predicate; instead
  // we load every live PENDING terrace booking (a naturally small set — only unpaid
  // holds) and decide per row against the tenant's cached settings.
  private async expireStalePending(now: Date): Promise<number> {
    const pastDateCutoff = new Date(now.getTime() - STALE_PENDING_GRACE_MS);
    const stale = await this.prisma.calendarEvent.findMany({
      where: {
        eventType: EventType.TERRACE_BOOKING,
        status: EventStatus.PENDING,
        deletedAt: null,
      },
      select: {
        id: true,
        condominiumId: true,
        createdById: true,
        createdAt: true,
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
        const reason = await this.resolveExpiryReason(event, now, pastDateCutoff);
        if (!reason) continue;

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
            reason === 'event-date-passed'
              ? 'Stale PENDING terrace booking auto-cancelled by maintenance (event date passed, never confirmed)'
              : 'Unpaid PENDING terrace booking auto-released by maintenance (tenant hold window exceeded)',
          afterState: {
            triggeredBy: SYSTEM_TRIGGER,
            reason,
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
        // CAL-060 — one bad row is swallowed so the sweep continues; capture it
        // for triage so a row that fails every night isn't invisible.
        Sentry.captureException(err, {
          tags: { condominiumId: event.condominiumId, eventId: event.id },
          extra: { stage: 'calendar-maintenance', pass: 'expire-pending' },
        });
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
        // CAL-071 — only a LIVE child blocks the purge: a Cascade FK (CAL-023)
        // could take a live child down with a removed parent, but children that
        // are themselves soft-deleted carry no such risk and must not pin the
        // parent for an extra cycle. (Occurrences of a recurring event are
        // virtual — expanded in findAll, never persisted — so this guard
        // protects client-supplied parentEventId links, not recurrence.)
        childEvents: { none: { deletedAt: null } },
        // CAL-057 — Transaction.matchedCalendarEvent has no onDelete (RESTRICT),
        // so hard-deleting a cancelled booking a transaction still references
        // throws P2003 and re-errors every nightly sweep. Never purge a
        // financially-referenced row; it stays soft-deleted while the link lives.
        matchedTransactions: { none: {} },
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
        // CAL-060 — capture per-row purge failures (e.g. an unexpected FK) so a
        // row that re-errors every sweep surfaces an alertable signal.
        Sentry.captureException(err, {
          tags: { condominiumId: event.condominiumId, eventId: event.id },
          extra: { stage: 'calendar-maintenance', pass: 'purge-soft-deleted' },
        });
      }
    }
    return purged;
  }

  /**
   * CAL-064 — decide whether (and why) a live PENDING terrace booking should be
   * released. The past-date branch is unconditional (mirrors the pre-CAL-064
   * behaviour, grace = `STALE_PENDING_GRACE_MS`). The hold-window branch fires only
   * when the tenant set `pendingHoldWindowHours > 0` and the booking's `createdAt`
   * is older than that window — releasing a future slot held unpaid. Returns `null`
   * when the booking should stay PENDING. Settings come from the tenant-scoped cache
   * (a row created without a settings record falls back to disabled).
   */
  private async resolveExpiryReason(
    event: { condominiumId: string; createdAt: Date; startDate: Date },
    now: Date,
    pastDateCutoff: Date,
  ): Promise<ExpiryReason | null> {
    if (event.startDate < pastDateCutoff) return 'event-date-passed';

    const settings = await this.settingsCache.getSettings(event.condominiumId);
    const holdHours = settings?.pendingHoldWindowHours ?? 0;
    if (holdHours > 0 && event.createdAt.getTime() < now.getTime() - holdHours * HOUR_MS) {
      return 'hold-window-exceeded';
    }
    return null;
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
