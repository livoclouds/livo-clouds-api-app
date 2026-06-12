import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ArcoRequestEventType,
  ArcoRequestStatus,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const ARCO_MODULE = 'resident-arco';
const SYSTEM_ACTOR = 'system';
// A still-RECEIVED request that has been overdue at least this many days is
// auto-escalated to IN_REVIEW so it cannot sit untouched past the legal window.
const AUTO_ESCALATE_AFTER_DAYS = 3;
// Only requests whose substantive SLA clock has started can be "overdue".
// PENDING_VERIFICATION (identity not confirmed) is intentionally excluded.
const ACTIVE_SLA_STATUSES: ArcoRequestStatus[] = [
  ArcoRequestStatus.RECEIVED,
  ArcoRequestStatus.IN_REVIEW,
];

export interface ArcoDeadlineSweepResult {
  overdueFlagged: number;
  escalated: number;
  adminNotified: number;
}

/**
 * Daily SLA enforcement for ARCO data-subject requests (LFPDPPP 20-business-day
 * window). Two idempotent passes:
 *
 *  1. **Flag** — any active (RECEIVED/IN_REVIEW), non-deleted request whose
 *     `dueDate` has passed and that has no OVERDUE event yet gets one OVERDUE
 *     timeline event + an `ARCO_OVERDUE` audit row, and the condominium admins
 *     are alerted (in-app fan-out).
 *  2. **Escalate** — a request still in RECEIVED more than
 *     `AUTO_ESCALATE_AFTER_DAYS` past its deadline, with no ESCALATED_BY_SYSTEM
 *     event yet, is moved to IN_REVIEW with an ESCALATED_BY_SYSTEM event.
 *
 * Each pass is guarded by the absence of its own event type, so the job is
 * idempotent and a request is flagged / escalated exactly once. A failed run is
 * logged and swallowed so the scheduler stays healthy.
 */
@Injectable()
export class ArcoDeadlineCron {
  private readonly logger = new Logger(ArcoDeadlineCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 6 * * *', {
    name: 'arco-deadline',
    timeZone: 'America/Mexico_City',
  })
  async scheduledSweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`arco-deadline: sweep failed: ${String(err)}`);
    }
  }

  async sweep(now: Date = new Date()): Promise<ArcoDeadlineSweepResult> {
    let overdueFlagged = 0;
    let escalated = 0;
    let adminNotified = 0;

    // --- Pass 1: flag newly overdue requests (once each) ---
    const overdue = await this.prisma.arcoRequest.findMany({
      where: {
        deletedAt: null,
        status: { in: ACTIVE_SLA_STATUSES },
        dueDate: { lt: now },
        events: { none: { type: ArcoRequestEventType.OVERDUE } },
      },
      select: { id: true, condominiumId: true, residentId: true, dueDate: true },
    });

    for (const req of overdue) {
      await this.prisma.arcoRequestEvent.create({
        data: {
          condominiumId: req.condominiumId,
          arcoRequestId: req.id,
          type: ArcoRequestEventType.OVERDUE,
          note: `due ${req.dueDate.toISOString()}`,
          createdBy: SYSTEM_ACTOR,
        },
      });
      await this.audit.log({
        condominiumId: req.condominiumId,
        userId: SYSTEM_ACTOR,
        action: 'ARCO_OVERDUE',
        actionCategory: 'UPDATE',
        module: ARCO_MODULE,
        entityType: 'ArcoRequest',
        entityId: req.id,
        afterState: { dueDate: req.dueDate },
        result: 'WARNING',
      });
      overdueFlagged += 1;

      // Best-effort admin alert — never blocks the sweep. `linkUrl` is a
      // tenant-less semantic pointer (CLAUDE.md golden rule #3); the web maps
      // type+data to its concrete route.
      try {
        const { recipientCount } = await this.notifications.dispatchEvent({
          type: NotificationType.ARCO_OVERDUE,
          condominiumId: req.condominiumId,
          title: 'notifications.types.ARCO_OVERDUE.title',
          message: 'notifications.types.ARCO_OVERDUE.body',
          data: { requestId: req.id, residentId: req.residentId },
          linkUrl: '/residents/arco',
        });
        adminNotified += recipientCount;
      } catch (err) {
        this.logger.error(
          `arco-deadline: admin alert failed for request=${req.id}: ${String(err)}`,
        );
      }
    }

    // --- Pass 2: auto-escalate long-overdue RECEIVED requests (once each) ---
    const escalateCutoff = new Date(
      now.getTime() - AUTO_ESCALATE_AFTER_DAYS * DAY_MS,
    );
    const stale = await this.prisma.arcoRequest.findMany({
      where: {
        deletedAt: null,
        status: ArcoRequestStatus.RECEIVED,
        dueDate: { lt: escalateCutoff },
        events: { none: { type: ArcoRequestEventType.ESCALATED_BY_SYSTEM } },
      },
      select: { id: true, condominiumId: true },
    });

    for (const req of stale) {
      await this.prisma.arcoRequest.update({
        where: { id: req.id },
        data: { status: ArcoRequestStatus.IN_REVIEW, updatedBy: SYSTEM_ACTOR },
      });
      await this.prisma.arcoRequestEvent.create({
        data: {
          condominiumId: req.condominiumId,
          arcoRequestId: req.id,
          type: ArcoRequestEventType.ESCALATED_BY_SYSTEM,
          fromStatus: ArcoRequestStatus.RECEIVED,
          toStatus: ArcoRequestStatus.IN_REVIEW,
          createdBy: SYSTEM_ACTOR,
        },
      });
      escalated += 1;
    }

    this.logger.log(
      `arco-deadline: sweep complete — flagged=${overdueFlagged} ` +
        `escalated=${escalated} adminNotified=${adminNotified}`,
    );
    return { overdueFlagged, escalated, adminNotified };
  }
}
