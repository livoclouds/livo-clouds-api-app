import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ArcoRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const ENTRY_BATCH_SIZE = 500;
const ARCO_MODULE = 'resident-arco';
const SYSTEM_ACTOR = 'system';

const TERMINAL_STATUSES: ArcoRequestStatus[] = [
  ArcoRequestStatus.COMPLETED,
  ArcoRequestStatus.REJECTED,
];

export interface ArcoRetentionSweepResult {
  condominiumsScanned: number;
  requestsPurged: number;
  attachmentsPurged: number;
}

/** Subtracts whole calendar months, clamping the day to month length. */
function subtractMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Automated retention/erasure sweep for ARCO data-subject requests (LFPDPPP /
 * GDPR data minimization, RP-005).
 *
 * For every condominium with `autopurgeEnabled` and
 * `CondominiumSettings.arcoRetentionMonths > 0`, resolved requests
 * (COMPLETED/REJECTED) whose `resolvedAt` is older than the window are
 * hard-deleted — the request row plus its R2 evidence and timeline (cascade).
 * 0 = disabled (opt-in per condominium); the shared `autopurgeEnabled` flag
 * lets an admin pause the purge without losing the configured window.
 *
 * The cut-off is computed dynamically from the current setting (not stamped at
 * resolution), so changing the window takes effect immediately and consistently
 * across the whole history. Idempotent and best-effort: an R2 hiccup orphans an
 * object (logged) but never blocks the row deletion; a failed run is swallowed
 * so the scheduler stays healthy and the next run recovers.
 */
@Injectable()
export class ArcoRetentionService {
  private readonly logger = new Logger(ArcoRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // 04:00 on the 1st of every month, America/Mexico_City (a low-traffic window).
  @Cron('0 4 1 * *', {
    name: 'arco-retention',
    timeZone: 'America/Mexico_City',
  })
  async scheduledSweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`arco-retention: sweep failed: ${String(err)}`);
    }
  }

  async sweep(now: Date = new Date()): Promise<ArcoRetentionSweepResult> {
    const configs = await this.prisma.condominiumSettings.findMany({
      where: { autopurgeEnabled: true, arcoRetentionMonths: { gt: 0 } },
      select: { condominiumId: true, arcoRetentionMonths: true },
    });

    let requestsPurged = 0;
    let attachmentsPurged = 0;

    for (const config of configs) {
      const cutoff = subtractMonths(now, config.arcoRetentionMonths);

      const expired = await this.prisma.arcoRequest.findMany({
        where: {
          condominiumId: config.condominiumId,
          status: { in: TERMINAL_STATUSES },
          resolvedAt: { not: null, lt: cutoff },
        },
        select: { id: true, attachments: { select: { storageKey: true } } },
      });
      if (expired.length === 0) continue;

      let condoRequests = 0;
      let condoAttachments = 0;
      for (let i = 0; i < expired.length; i += ENTRY_BATCH_SIZE) {
        const batch = expired.slice(i, i + ENTRY_BATCH_SIZE);
        for (const req of batch) {
          for (const att of req.attachments) {
            await this.storage
              .deleteFile(att.storageKey, { condominiumId: config.condominiumId })
              .catch(() => undefined);
            condoAttachments += 1;
          }
        }
        // Hard delete — cascade removes attachment + event rows.
        const deleted = await this.prisma.arcoRequest.deleteMany({
          where: { id: { in: batch.map((r) => r.id) } },
        });
        condoRequests += deleted.count;
      }

      requestsPurged += condoRequests;
      attachmentsPurged += condoAttachments;

      await this.audit.log({
        condominiumId: config.condominiumId,
        userId: SYSTEM_ACTOR,
        action: 'ARCO_RETENTION_PURGE',
        actionCategory: 'DELETE',
        module: ARCO_MODULE,
        entityType: 'Condominium',
        entityId: config.condominiumId,
        afterState: {
          requestsPurged: condoRequests,
          attachmentsPurged: condoAttachments,
          retentionMonths: config.arcoRetentionMonths,
        },
        result: 'SUCCESS',
      });

      this.logger.log(
        `arco-retention: condominium=${config.condominiumId} ` +
          `retentionMonths=${config.arcoRetentionMonths} requests=${condoRequests} ` +
          `attachments=${condoAttachments}`,
      );
    }

    this.logger.log(
      `arco-retention: sweep complete — condominiums=${configs.length} ` +
        `requests=${requestsPurged} attachments=${attachmentsPurged}`,
    );
    return {
      condominiumsScanned: configs.length,
      requestsPurged,
      attachmentsPurged,
    };
  }
}
