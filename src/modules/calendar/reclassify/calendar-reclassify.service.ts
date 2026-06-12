import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClassificationService } from '../../classification/classification.service';
import {
  CALENDAR_TERRACE_CHANGED,
  type CalendarTerraceChangedPayload,
} from '../events/calendar-terrace-changed.event';

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

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    for (const batchId of batches) {
      const key = `${payload.condominiumId}:${batchId}`;
      if (this.inFlight.has(key)) {
        skipped++;
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
    this.logger.log(
      `Auto-reclassify done — event=${payload.triggeringEventId} succeeded=${succeeded} failed=${failed} skipped=${skipped}`,
    );
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
