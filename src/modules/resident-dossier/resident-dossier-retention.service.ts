import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DossierCategory, DossierConfidentiality } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const ENTRY_BATCH_SIZE = 500;
const DOSSIER_MODULE = 'resident-dossier';
const SYSTEM_ACTOR = 'system';

export interface DossierRetentionSweepResult {
  condominiumsScanned: number;
  entriesPurged: number;
  attachmentsPurged: number;
}

/**
 * Automated retention sweep for the resident dossier (Capa 2D).
 *
 * For every condominium with `CondominiumSettings.dossierRetentionDays > 0`,
 * soft-deleted dossier entries whose `deletedAt` is older than the window are
 * hard-deleted (row + R2 evidence). 0 = disabled (opt-in per condominium).
 *
 * **Legal hold (automatic):** entries of category `LEGAL` or confidentiality
 * `LEGAL_CONFIDENTIAL` are NEVER auto-purged — they survive the sweep regardless
 * of age and can only be removed by an explicit manual purge (Capa 2C).
 *
 * The job is idempotent and best-effort: an R2 hiccup orphans an object (logged)
 * but never blocks the row deletion; a failed run is swallowed so the scheduler
 * stays healthy and the next day recovers the backlog.
 */
@Injectable()
export class DossierRetentionService {
  private readonly logger = new Logger(DossierRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Cron('0 2 * * *', {
    name: 'dossier-retention',
    timeZone: 'America/Mexico_City',
  })
  async scheduledSweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`dossier-retention: sweep failed: ${String(err)}`);
    }
  }

  async sweep(now: Date = new Date()): Promise<DossierRetentionSweepResult> {
    const configs = await this.prisma.condominiumSettings.findMany({
      // Purge only where the toggle is on AND a positive window is configured.
      where: { autopurgeEnabled: true, dossierRetentionDays: { gt: 0 } },
      select: { condominiumId: true, dossierRetentionDays: true },
    });

    let entriesPurged = 0;
    let attachmentsPurged = 0;

    for (const config of configs) {
      const cutoff = new Date(now.getTime() - config.dossierRetentionDays * DAY_MS);

      // Only the recycle bin (soft-deleted) past the window, and never the
      // legal-hold set: category LEGAL or confidentiality LEGAL_CONFIDENTIAL.
      const expired = await this.prisma.residentDossierEntry.findMany({
        where: {
          condominiumId: config.condominiumId,
          deletedAt: { not: null, lt: cutoff },
          category: { not: DossierCategory.LEGAL },
          confidentiality: { not: DossierConfidentiality.LEGAL_CONFIDENTIAL },
        },
        select: { id: true, attachments: { select: { storageKey: true } } },
      });
      if (expired.length === 0) continue;

      let condoEntries = 0;
      let condoAttachments = 0;
      for (let i = 0; i < expired.length; i += ENTRY_BATCH_SIZE) {
        const batch = expired.slice(i, i + ENTRY_BATCH_SIZE);
        for (const entry of batch) {
          for (const att of entry.attachments) {
            await this.storage
              .deleteFile(att.storageKey, { condominiumId: config.condominiumId })
              .catch(() => undefined);
            condoAttachments += 1;
          }
        }
        // Hard delete the batch — cascade removes attachments + events rows.
        const deleted = await this.prisma.residentDossierEntry.deleteMany({
          where: { id: { in: batch.map((e) => e.id) } },
        });
        condoEntries += deleted.count;
      }

      entriesPurged += condoEntries;
      attachmentsPurged += condoAttachments;

      await this.audit.log({
        condominiumId: config.condominiumId,
        userId: SYSTEM_ACTOR,
        action: 'DOSSIER_RETENTION_PURGED',
        actionCategory: 'DELETE',
        module: DOSSIER_MODULE,
        entityType: 'Condominium',
        entityId: config.condominiumId,
        afterState: {
          entriesPurged: condoEntries,
          attachmentsPurged: condoAttachments,
          retentionDays: config.dossierRetentionDays,
        },
        result: 'SUCCESS',
      });

      this.logger.log(
        `dossier-retention: condominium=${config.condominiumId} ` +
          `retentionDays=${config.dossierRetentionDays} entries=${condoEntries} ` +
          `attachments=${condoAttachments}`,
      );
    }

    this.logger.log(
      `dossier-retention: sweep complete — condominiums=${configs.length} ` +
        `entries=${entriesPurged} attachments=${attachmentsPurged}`,
    );
    return {
      condominiumsScanned: configs.length,
      entriesPurged,
      attachmentsPurged,
    };
  }
}
