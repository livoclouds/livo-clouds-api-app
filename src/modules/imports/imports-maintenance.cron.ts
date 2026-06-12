import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { ABANDONED_PENDING_MS, STALE_PROCESSING_MS } from './imports.constants';

// audit_logs.userId is a REQUIRED FK to users — a literal 'system' actor would
// FK-fail. Cron-driven audit rows are attributed to the batch's importer
// (importedById) with `triggeredBy: 'system-reaper'` in afterState marking the
// real actor.
const SYSTEM_TRIGGER = 'system-reaper';

export interface ImportsMaintenanceSweepResult {
  stuckRecovered: number;
  orphansPurged: number;
}

/**
 * ENGINE-004 / ENGINE-048 — imports maintenance reaper. Two idempotent passes
 * every 15 minutes:
 *
 *  1. **Stuck-PROCESSING recovery** — classification runs in-process via
 *     `setImmediate` (no queue, CLAUDE.md §19); a crash mid-classify leaves
 *     the batch PROCESSING forever with no caller alive to recover it. Any
 *     batch PROCESSING longer than `STALE_PROCESSING_MS` is flagged FAILED
 *     with an actionable errorMessage; its transactions stay persisted and
 *     the batch is recoverable via POST /classification/imports/:id/classify
 *     (status-restoring since ENGINE-004).
 *  2. **Abandoned-upload purge** — PENDING batches with a retained R2 object,
 *     zero transactions, older than `ABANDONED_PENDING_MS` are uploads whose
 *     preview/confirm never happened. The R2 object and the batch row are
 *     deleted (safe: no FK children by construction).
 *
 * Honest limitation: R2 objects whose batch row was already hard-deleted
 * (pre-ENGINE-048 strict-mode rollbacks) are unreachable — StorageService has
 * no list API, so this sweep is DB-driven by design.
 *
 * A failed run is logged and swallowed so the scheduler stays healthy.
 */
@Injectable()
export class ImportsMaintenanceCron {
  private readonly logger = new Logger(ImportsMaintenanceCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Cron('*/15 * * * *', {
    name: 'imports-stuck-batch-reaper',
    timeZone: 'America/Mexico_City',
  })
  async scheduledSweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`imports-maintenance: sweep failed: ${String(err)}`);
    }
  }

  async sweep(now: Date = new Date()): Promise<ImportsMaintenanceSweepResult> {
    let stuckRecovered = 0;
    let orphansPurged = 0;

    // --- Pass 1: flag stalled PROCESSING batches as FAILED ---
    const stuckCutoff = new Date(now.getTime() - STALE_PROCESSING_MS);
    const stuck = await this.prisma.importBatch.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: stuckCutoff } },
      select: {
        id: true,
        condominiumId: true,
        importedById: true,
        fileName: true,
        updatedAt: true,
      },
    });

    for (const batch of stuck) {
      try {
        // Conditional update — a concurrent recovery/classify run may have
        // already moved the batch on; never clobber a fresh transition.
        const result = await this.prisma.importBatch.updateMany({
          where: {
            id: batch.id,
            status: 'PROCESSING',
            updatedAt: { lt: stuckCutoff },
          },
          data: {
            status: 'FAILED',
            errorMessage:
              'Classification stalled and was recovered by the maintenance reaper. Re-run classification to complete the import.',
          },
        });
        if (result.count === 0) continue;

        await this.audit.log({
          condominiumId: batch.condominiumId,
          userId: batch.importedById,
          action: 'IMPORT_FAILED',
          actionCategory: 'UPDATE',
          module: 'imports',
          entityType: 'ImportBatch',
          entityId: batch.id,
          result: 'WARNING',
          description:
            'Stuck PROCESSING batch flagged FAILED by the maintenance reaper (transactions persisted; reclassify to recover)',
          afterState: {
            errorCode: 'CLASSIFICATION_STALLED',
            stalledSince: batch.updatedAt,
            triggeredBy: SYSTEM_TRIGGER,
          },
        });
        stuckRecovered += 1;
      } catch (err) {
        // One bad batch must not abort the rest of the sweep.
        this.logger.error(
          `imports-maintenance: stuck-pass failed for batch=${batch.id}: ${String(err)}`,
        );
      }
    }

    // --- Pass 2: purge abandoned PENDING uploads (R2 object + batch row) ---
    const abandonedCutoff = new Date(now.getTime() - ABANDONED_PENDING_MS);
    const abandoned = await this.prisma.importBatch.findMany({
      where: {
        status: 'PENDING',
        storageKey: { not: null },
        createdAt: { lt: abandonedCutoff },
        transactions: { none: {} },
      },
      select: {
        id: true,
        condominiumId: true,
        importedById: true,
        storageKey: true,
      },
    });

    for (const batch of abandoned) {
      if (!batch.storageKey) continue;
      try {
        await this.storage.deleteFile(batch.storageKey);
      } catch (err) {
        // Leave the row in place so the next sweep retries the delete —
        // removing the DB pointer first would orphan the object forever.
        this.logger.error(
          `imports-maintenance: R2 delete failed for batch=${batch.id}, retrying next sweep: ${String(err)}`,
        );
        continue;
      }
      await this.prisma.importBatch.delete({ where: { id: batch.id } });
      await this.audit.log({
        condominiumId: batch.condominiumId,
        userId: batch.importedById,
        action: 'IMPORT_DELETED',
        actionCategory: 'DELETE',
        module: 'imports',
        entityType: 'ImportBatch',
        entityId: batch.id,
        result: 'SUCCESS',
        description:
          'Abandoned PENDING upload purged by the maintenance reaper (no transactions; retained file deleted)',
        afterState: {
          errorCode: 'IMPORT_BATCH_PURGED',
          triggeredBy: SYSTEM_TRIGGER,
        },
      });
      orphansPurged += 1;
    }

    this.logger.log(
      `imports-maintenance: sweep complete — stuckRecovered=${stuckRecovered} orphansPurged=${orphansPurged}`,
    );
    return { stuckRecovered, orphansPurged };
  }
}
