import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ClassificationService } from '../../classification/classification.service';
import {
  CALENDAR_TERRACE_CHANGED,
  type CalendarTerraceChangedPayload,
} from '../events/calendar-terrace-changed.event';

// CAL-033: when a batch is already in-flight under a concurrent run, the batch
// is requeued (not dropped) and retried after a short delay so its effects are
// never silently skipped. Bounded so a permanently-contended key can't loop.
const REQUEUE_DELAY_MS = 250;
const MAX_REQUEUE_ATTEMPTS = 3;

// CAL-039: engine reclassify runs outside any HTTP request. audit_logs.userId is
// a required FK to users, so a literal 'system' actor would FK-fail; the row is
// attributed to the user whose calendar write triggered the run (payload.actorUserId)
// with this marker in afterState identifying the real actor.
const SYSTEM_TRIGGER = 'system-reclassify';

export interface ReclassifyRunResult {
  succeeded: number;
  failed: number;
  requeued: number;
}

@Injectable()
export class CalendarReclassifyService {
  private readonly logger = new Logger(CalendarReclassifyService.name);
  // Best-effort in-memory dedupe: prevents redundant cycles when a flurry of
  // edits hits the same batch back-to-back. Multi-instance deployments would
  // need Redis SETNX — tracked as a known tradeoff in the calendar docs.
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationService,
    private readonly audit: AuditService,
  ) {}

  @OnEvent(CALENDAR_TERRACE_CHANGED)
  handle(payload: CalendarTerraceChangedPayload): void {
    setImmediate(() => {
      this.run(payload).catch((err) => {
        this.logger.error(
          `Auto-reclassify failed for event ${payload.triggeringEventId}`,
          err instanceof Error ? err.stack : String(err),
        );
        // ENGINE-033: event-handler context — outside any HTTP request, so the
        // Sentry exception filter never sees it. No-op until SENTRY_DSN is set.
        Sentry.captureException(err, {
          tags: { condominiumId: payload.condominiumId },
          extra: {
            stage: 'calendar-auto-reclassify',
            triggeringEventId: payload.triggeringEventId,
            action: payload.action,
          },
        });
      });
    });
  }

  async run(payload: CalendarTerraceChangedPayload): Promise<void> {
    const batches = await this.findAffectedBatches(payload);
    if (batches.length === 0) {
      this.logger.log(
        `Auto-reclassify skipped (no batches in window) — event=${payload.triggeringEventId} action=${payload.action} reason=${payload.reason}`,
      );
      return;
    }
    this.logger.log(
      `Auto-reclassify start — event=${payload.triggeringEventId} action=${payload.action} batches=${batches.length} reason=${payload.reason}`,
    );

    const result = await this.processBatches(payload, batches, 0);

    this.logger.log(
      `Auto-reclassify done — event=${payload.triggeringEventId} succeeded=${result.succeeded} failed=${result.failed} requeued=${result.requeued}`,
    );

    // CAL-039: leave an audit trail for the engine-triggered run. Attributed to
    // the triggering user (FK-safe) with the system marker in afterState.
    await this.writeAuditTrail(payload, result);
  }

  /**
   * Process a set of batches, retrying any that are currently in-flight under a
   * concurrent run rather than dropping them (CAL-033). Returns the run tally.
   */
  async processBatches(
    payload: CalendarTerraceChangedPayload,
    batchIds: string[],
    attempt: number,
  ): Promise<ReclassifyRunResult> {
    let succeeded = 0;
    let failed = 0;
    const requeuedBatches: string[] = [];

    for (const batchId of batchIds) {
      const key = `${payload.condominiumId}:${batchId}`;
      if (this.inFlight.has(key)) {
        // A concurrent run holds this batch. Requeue instead of dropping so the
        // edit's effect is not silently lost.
        requeuedBatches.push(batchId);
        continue;
      }
      this.inFlight.add(key);
      try {
        await this.classification.reclassifyBatch(payload.condominiumId, batchId, null);
        succeeded++;
      } catch (err) {
        failed++;
        this.logger.error(
          `Auto-reclassify batch ${batchId} failed`,
          err instanceof Error ? err.stack : String(err),
        );
        // ENGINE-033: per-batch failures are swallowed by design (the loop
        // continues with the remaining batches) — capture each one for triage.
        Sentry.captureException(err, {
          tags: { batchId, condominiumId: payload.condominiumId },
          extra: {
            stage: 'calendar-auto-reclassify',
            triggeringEventId: payload.triggeringEventId,
          },
        });
      } finally {
        this.inFlight.delete(key);
      }
    }

    if (requeuedBatches.length > 0 && attempt < MAX_REQUEUE_ATTEMPTS) {
      this.logger.log(
        `Auto-reclassify requeue — event=${payload.triggeringEventId} batches=${requeuedBatches.length} attempt=${attempt + 1}/${MAX_REQUEUE_ATTEMPTS}`,
      );
      this.scheduleRequeue(payload, requeuedBatches, attempt + 1);
    } else if (requeuedBatches.length > 0) {
      this.logger.warn(
        `Auto-reclassify gave up requeue after ${MAX_REQUEUE_ATTEMPTS} attempts — event=${payload.triggeringEventId} batches=${requeuedBatches.length}`,
      );
    }

    return { succeeded, failed, requeued: requeuedBatches.length };
  }

  /**
   * Schedule a bounded retry of contended batches. Isolated so tests can stub it
   * and assert requeue without relying on timers.
   */
  protected scheduleRequeue(
    payload: CalendarTerraceChangedPayload,
    batchIds: string[],
    attempt: number,
  ): void {
    setTimeout(() => {
      this.processBatches(payload, batchIds, attempt).catch((err) => {
        this.logger.error(
          `Auto-reclassify requeue run failed — event=${payload.triggeringEventId}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }, REQUEUE_DELAY_MS).unref?.();
  }

  private async writeAuditTrail(
    payload: CalendarTerraceChangedPayload,
    result: ReclassifyRunResult,
  ): Promise<void> {
    if (!payload.actorUserId) return; // no FK-safe actor → skip rather than FK-fail
    try {
      await this.audit.log({
        condominiumId: payload.condominiumId,
        userId: payload.actorUserId,
        action: 'CALENDAR_AUTO_RECLASSIFY',
        actionCategory: 'UPDATE',
        module: 'calendar',
        entityType: 'CalendarEvent',
        entityId: payload.triggeringEventId,
        result: result.failed > 0 ? 'WARNING' : 'SUCCESS',
        description:
          'Terrace booking change triggered an automatic transaction re-match',
        afterState: {
          triggeredBy: SYSTEM_TRIGGER,
          action: payload.action,
          reason: payload.reason,
          succeeded: result.succeeded,
          failed: result.failed,
          requeued: result.requeued,
        },
      });
    } catch (err) {
      // The audit row is observability, never the source of truth — a logging
      // failure must not bubble up and mark the reclassify run as failed.
      this.logger.error(
        `Auto-reclassify audit write failed — event=${payload.triggeringEventId}: ${String(err)}`,
      );
    }
  }

  async findAffectedBatches(payload: CalendarTerraceChangedPayload): Promise<string[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        condominiumId: payload.condominiumId,
        flowType: 'INCOME',
        transactionDate: { gte: payload.windowStart, lte: payload.windowEnd },
      },
      select: { importBatchId: true },
      distinct: ['importBatchId'],
    });
    return rows.map((r) => r.importBatchId);
  }
}
