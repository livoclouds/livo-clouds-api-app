// Batch classification orchestration (ENGINE-008 decomposition, Phase 6).
// Owns the candidate/correction-pattern loading, the chunked classify/persist
// loops (classifyBatch, reclassifyBatch, reapplyToPending) and the batch
// status lifecycle around them. Extracted verbatim from ClassificationService;
// the facade delegates here.
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClassificationStatus, ReconciliationStatus, BankDialect, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReconciliationRulesService } from '../reconciliation-rules/reconciliation-rules.service';
import {
  CLASSIFICATION_REVIEW_NEEDED_EVENT,
  type ClassificationReviewNeededEventPayload,
} from './events/classification-notification-events';
import { type TerraceCandidate } from './terrace-booking-matcher';
import { validateTerraceMetadata } from '../calendar/terrace-metadata.validator';
import { SettingsCacheService } from '../settings/settings-cache.service';
import { STALE_PROCESSING_MS } from '../imports/imports.constants';
import { SummaryRecomputeService } from '../reconciliation/summary-recompute.service';
import {
  normalizeText,
  type ClassificationSummary,
  type CorrectionPatternData,
  type DbRule,
  type ResidentData,
} from './engine/extraction.util';
import { classifyTransaction } from './engine/transaction-classifier';

/**
 * Phase 6 (A4): page size for cursor-batched loading of classification
 * candidate sets (residents, terrace bookings). The matcher needs the complete
 * set in memory, so this bounds the per-query result/driver buffer — not the
 * working set. A small condominium returns a single page (< pageSize) and stops
 * after one round, so behavior is unchanged for the common case.
 */
const CANDIDATE_PAGE_SIZE = 500;

@Injectable()
export class BatchClassificationService {
  private readonly logger = new Logger(BatchClassificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rulesService: ReconciliationRulesService,
    private readonly events: EventEmitter2,
    private readonly settingsCache: SettingsCacheService,
    private readonly summaries: SummaryRecomputeService,
  ) {}

  /**
   * Phase 6 (A4): loads a full result set in id-ordered cursor pages, bounding
   * the per-query result size. Stops as soon as a short page is returned. The
   * stable `id` ordering does not change classification output — both the
   * resident matcher (unique unit-number / single-best-name) and the terrace
   * matcher (ambiguous ties null out the match) are order-independent for the
   * persisted result.
   */
  private async loadAllByCursor<T extends { id: string }>(
    fetchPage: (cursor: string | undefined, take: number) => Promise<T[]>,
    pageSize: number = CANDIDATE_PAGE_SIZE,
  ): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchPage(cursor, pageSize);
      all.push(...page);
      if (page.length < pageSize) break;
      cursor = page[page.length - 1].id;
    }
    return all;
  }

  /**
   * Phase 6 (A4 + A5): loads the classification candidate sets shared by
   * {@link classifyBatch} and {@link reapplyToPending}. Residents and terrace
   * bookings are read in cursor pages; tenant terrace keywords come from the
   * settings cache (A5).
   */
  private async loadCandidates(condominiumId: string): Promise<{
    residents: ResidentData[];
    activeRules: DbRule[];
    terraceEvents: TerraceCandidate[];
    terraceGlobalKeywords: string[];
    totalUnits: number;
    ordinaryFeeAmount: number;
    lateFeeAmount: number;
  }> {
    const [residents, activeRules, rawTerraceEvents, settings] = await Promise.all([
      this.loadAllByCursor<ResidentData>((cursor, take) =>
        this.prisma.resident.findMany({
          where: { condominiumId, deletedAt: null },
          select: { id: true, unitNumber: true, firstName: true, lastName: true },
          orderBy: { id: 'asc' },
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      ),
      this.rulesService.findActive(condominiumId),
      this.loadAllByCursor((cursor, take) =>
        // Load active, non-cancelled TERRACE_BOOKING events; PENDING-payment
        // filtering happens below against the parsed metadata.
        this.prisma.calendarEvent.findMany({
          where: {
            condominiumId,
            eventType: 'TERRACE_BOOKING',
            status: { not: 'CANCELLED' },
            deletedAt: null,
          },
          select: { id: true, residentId: true, unitNumber: true, startDate: true, metadata: true },
          orderBy: { id: 'asc' },
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      ),
      // Phase 6 (A5): tenant terrace keywords from the settings cache.
      this.settingsCache.getSettings(condominiumId),
    ]);

    const terraceGlobalKeywords = settings?.terraceGlobalKeywords ?? [];
    const totalUnits = settings?.totalUnits ?? 0;
    const ordinaryFeeAmount = Number(settings?.ordinaryFeeAmount ?? 0);
    const lateFeeAmount = Number(settings?.lateFeeAmount ?? 0);

    // Parse terrace metadata and filter to events with PENDING payment.
    const terraceEvents: TerraceCandidate[] = rawTerraceEvents.flatMap((ev) => {
      const validation = validateTerraceMetadata(ev.metadata);
      if (!validation.valid || validation.data.paymentStatus !== 'PENDING') return [];
      return [{
        id: ev.id,
        residentId: ev.residentId,
        unitNumber: ev.unitNumber,
        startDate: new Date(ev.startDate),
        terraceRentalAmount: validation.data.terraceRentalAmount,
        customKeywords: validation.data.customKeywords,
      }];
    });

    return {
      residents,
      activeRules,
      terraceEvents,
      terraceGlobalKeywords,
      totalUnits,
      ordinaryFeeAmount,
      lateFeeAmount,
    };
  }

  /**
   * ENGINE-043: loads the tenant's recurring manual corrections (seen at least
   * twice) as a Map keyed by normalized description, for the learned-correction
   * pass. Rows whose outcome is entirely empty are skipped.
   */
  private async loadCorrectionPatterns(
    condominiumId: string,
  ): Promise<Map<string, CorrectionPatternData>> {
    const rows = await this.prisma.reconciliationCorrectionPattern.findMany({
      where: { condominiumId, occurrenceCount: { gte: 2 } },
      select: {
        originalDescription: true,
        selectedUnitNumber: true,
        selectedResidentId: true,
        selectedConcept: true,
      },
    });
    const map = new Map<string, CorrectionPatternData>();
    for (const row of rows) {
      if (!row.selectedUnitNumber && !row.selectedResidentId && !row.selectedConcept) continue;
      map.set(normalizeText(row.originalDescription), {
        selectedUnitNumber: row.selectedUnitNumber,
        selectedResidentId: row.selectedResidentId,
        selectedConcept: row.selectedConcept,
      });
    }
    return map;
  }

  /**
   * Best-effort write of the per-batch classification progress counter. A
   * failure here (e.g. the batch row was deleted mid-run) must never abort
   * classification, so it only logs a warning.
   */
  private async writeProgress(batchId: string, processedCount: number): Promise<void> {
    try {
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { processedCount },
      });
    } catch (err) {
      this.logger.warn(
        `classifyBatch: progress write failed batchId=${batchId} processed=${processedCount}: ${String(err)}`,
      );
    }
  }

  async classifyBatch(
    condominiumId: string,
    batchId: string,
    actorUserId?: string,
  ): Promise<ClassificationSummary> {
    // Phase 6 (A4 + A5): candidate sets (residents, terrace bookings) are
    // cursor-batched and terrace keywords come from the settings cache; the
    // batch's own transactions are bounded by the import file.
    const [
      { residents, activeRules, terraceEvents, terraceGlobalKeywords, totalUnits, ordinaryFeeAmount, lateFeeAmount },
      transactions,
      batchInfo,
      correctionPatterns,
    ] = await Promise.all([
      this.loadCandidates(condominiumId),
      this.prisma.transaction.findMany({
        where: { condominiumId, importBatchId: batchId },
        select: { id: true, description: true, transactionDate: true, credits: true, charges: true, flowType: true },
      }),
      this.prisma.importBatch.findUnique({
        where: { id: batchId },
        // ENGINE-009: the engine reads the validated dialect field, never the
        // free-text bankName.
        select: { bankProfile: { select: { dialect: true } } },
      }),
      this.loadCorrectionPatterns(condominiumId),
    ]);

    // The whole batch shares one bank profile, so the dialect is read once.
    const dialect = batchInfo?.bankProfile?.dialect ?? BankDialect.GENERIC;

    let classified = 0;
    let needsReview = 0;
    let unmatched = 0;
    let skipped = 0;

    // Reset the progress counter for this run (best-effort — progress writes must
    // never fail classification). The web polls processedCount/transactionCount to
    // drive a real per-transaction progress bar during the "classifying" phase.
    await this.writeProgress(batchId, 0);

    const CHUNK = 200;
    for (let i = 0; i < transactions.length; i += CHUNK) {
      const chunk = transactions.slice(i, i + CHUNK);
      // Single timestamp per chunk so auto-matched rows with identical
      // payloads can collapse into the same updateMany group. The roadmap
      // (Phase 3 validation) explicitly excludes matchedAt from the
      // byte-for-byte equivalence requirement.
      const nowForChunk = new Date();

      const groups = new Map<string, { ids: string[]; data: Prisma.TransactionUncheckedUpdateManyInput }>();

      for (const tx of chunk) {
        const terraceContext = tx.flowType === 'INCOME' && terraceEvents.length > 0
          ? {
              events: terraceEvents,
              amount: tx.credits ? Number(tx.credits) : null,
              transactionDate: new Date(tx.transactionDate),
              globalKeywords: terraceGlobalKeywords,
            }
          : undefined;

        // Maintenance-fee pass runs only for BANBAJIO-dialect INCOME (the
        // concept format is bank-specific). Fees come from the condominium settings.
        const maintenanceContext =
          tx.flowType === 'INCOME' && dialect === BankDialect.BANBAJIO
            ? { amount: tx.credits ? Number(tx.credits) : null, ordinaryFeeAmount, lateFeeAmount }
            : undefined;

        const result = classifyTransaction(
          tx.description,
          new Date(tx.transactionDate),
          residents,
          activeRules,
          terraceContext,
          { dialect, totalUnits },
          maintenanceContext,
          tx.flowType,
          correctionPatterns,
        );

        const data: Prisma.TransactionUncheckedUpdateManyInput = {
          unitNumberDetected: result.unitNumberDetected,
          unitNumbersDetected: result.unitNumbersDetected,
          payerNameDetected: result.payerNameDetected,
          paymentConcept: result.paymentConcept,
          expenseCategoryId: result.expenseCategoryId ?? null,
          supplierId: result.supplierId ?? null,
          paymentPeriodYear: result.paymentPeriodYear,
          paymentPeriodMonth: result.paymentPeriodMonth,
          matchSource: result.matchSource,
          matchedPatternLabel: result.matchedPatternLabel ?? null,
          confidenceScore: result.confidenceScore
            ? new Prisma.Decimal(result.confidenceScore.toFixed(4))
            : null,
          matchedAt: result.matchedAt ? nowForChunk : null,
          residentId: result.residentId,
          classificationStatus: result.classificationStatus,
          requiresReviewReason: result.requiresReviewReason ?? null,
          matchedRuleId: result.matchedRuleId ?? null,
          matchedCalendarEventId: result.matchedCalendarEventId ?? null,
        };

        const key = JSON.stringify(data, (_k, v) =>
          v instanceof Prisma.Decimal ? v.toString() : v,
        );
        const existing = groups.get(key);
        if (existing) {
          existing.ids.push(tx.id);
        } else {
          groups.set(key, { ids: [tx.id], data });
        }
      }

      // ENGINE-018: the write re-asserts the row is still the engine's to
      // classify — a manual classification or reconciliation landed during
      // the run wins, and the row is skipped + reported instead of being
      // silently overwritten. Counters derive from the write counts (each
      // group carries one payload), so the summary reflects what was
      // actually persisted, not what the in-memory loop intended.
      const groupList = Array.from(groups.values());
      const results = await this.prisma.$transaction(
        groupList.map(({ ids, data }) =>
          this.prisma.transaction.updateMany({
            where: {
              condominiumId,
              id: { in: ids },
              classificationStatus: { not: ClassificationStatus.MANUAL_OVERRIDE },
              reconciliationStatus: ReconciliationStatus.PENDING,
            },
            data,
          }),
        ),
      );
      groupList.forEach(({ ids, data }, idx) => {
        const count = results[idx].count;
        if (data.classificationStatus === ClassificationStatus.AUTO) {
          classified += count;
        } else {
          needsReview += count;
          if (data.residentId === null) unmatched += count;
        }
        skipped += ids.length - count;
      });

      // Publish progress after each chunk so the web poll sees a smooth advance.
      await this.writeProgress(batchId, Math.min(i + chunk.length, transactions.length));
    }

    await this.summaries.upsertMonthlySummaries(condominiumId, batchId);

    // Notify only when the batch genuinely left transactions for manual
    // review. Best-effort: a listener failure must not fail classification.
    if (needsReview > 0) {
      try {
        this.events.emit(CLASSIFICATION_REVIEW_NEEDED_EVENT, {
          condominiumId,
          batchId,
          transactionCount: needsReview,
          actorUserId,
        } satisfies ClassificationReviewNeededEventPayload);
      } catch (emitErr) {
        this.logger.warn(
          `classifyBatch: notification emit failed batchId=${batchId}: ${String(emitErr)}`,
        );
      }
    }

    return { total: transactions.length, classified, needsReview, unmatched, skipped };
  }

  async reclassifyBatch(
    condominiumId: string,
    batchId: string,
    userId: string | null,
  ): Promise<ClassificationSummary> {
    // ENGINE-004 — status-restoring re-run. A fresh PROCESSING batch belongs
    // to a live classification run and must not be re-entered; a stale one
    // (crashed mid-classify) or a FAILED one with persisted transactions is
    // exactly what this path recovers. The batch is held in PROCESSING while
    // the re-run executes and lands COMPLETED (or FAILED with errorMessage).
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, condominiumId },
      select: { status: true, updatedAt: true, completedAt: true },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (
      batch.status === 'PROCESSING' &&
      Date.now() - batch.updatedAt.getTime() < STALE_PROCESSING_MS
    ) {
      throw new ConflictException({
        code: 'IMPORT_BATCH_PROCESSING',
        reason:
          'Classification for this batch is still running. Retry once it finishes (or stalls).',
        existingBatchId: batchId,
      });
    }

    const beforeCounts = await this.prisma.transaction.groupBy({
      by: ['classificationStatus'],
      where: { condominiumId, importBatchId: batchId },
      _count: { _all: true },
    });
    const beforeSummary = beforeCounts.reduce<Record<string, number>>(
      (acc, row) => {
        acc[row.classificationStatus] = row._count._all;
        return acc;
      },
      {},
    );

    await this.prisma.importBatch.updateMany({
      where: { id: batchId, condominiumId },
      data: { status: 'PROCESSING' },
    });

    // ENGINE-003: rows a human already settled — manual overrides and
    // already-reconciled rows — are excluded from the reset so a one-click
    // reclassify can never destroy manual work. The count is reported back
    // so the operator sees how much was preserved.
    const resetScope = {
      classificationStatus: { not: ClassificationStatus.MANUAL_OVERRIDE },
      reconciliationStatus: ReconciliationStatus.PENDING,
    } as const;
    const totalInBatch = await this.prisma.transaction.count({
      where: { condominiumId, importBatchId: batchId },
    });
    const resetEligible = await this.prisma.transaction.count({
      where: { condominiumId, importBatchId: batchId, ...resetScope },
    });
    const preservedManual = totalInBatch - resetEligible;

    let summary: ClassificationSummary;
    try {
      // The reset wipes every engine-owned resident link, so the matching
      // splits must go with it — atomically, or a crash between the two
      // writes leaves allocations pointing at unlinked transactions
      // (ENGINE-006). Allocations of preserved (manual/reconciled) rows
      // survive: the delete is predicated on the same reset scope.
      await this.prisma.$transaction([
        this.prisma.paymentAllocation.deleteMany({
          where: {
            condominiumId,
            transaction: { importBatchId: batchId, condominiumId, ...resetScope },
          },
        }),
        this.prisma.transaction.updateMany({
          where: { condominiumId, importBatchId: batchId, ...resetScope },
          data: {
            classificationStatus: ClassificationStatus.NEEDS_REVIEW,
            residentId: null,
            matchSource: null,
            matchedPatternLabel: null,
            confidenceScore: null,
            matchedAt: null,
            requiresReviewReason: null,
            matchedRuleId: null,
            matchedCalendarEventId: null,
            classificationVersion: { increment: 1 },
          },
        }),
      ]);
      summary = await this.classifyBatch(condominiumId, batchId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.importBatch.updateMany({
        where: { id: batchId, condominiumId },
        data: {
          status: 'FAILED',
          errorMessage: `Reclassification failed: ${message}`,
        },
      });
      throw err;
    }

    // ENGINE-058 — keep the persisted batch summary in sync with the re-run.
    // (reapplyToPending is tenant-wide, not batch-scoped — out of its scope.)
    // ENGINE-004 — restore the terminal status so a recovered FAILED/stuck
    // batch becomes COMPLETED again.
    // ENGINE-003: with preservation, the re-run summary no longer covers the
    // whole batch — the persisted counts come from the actual DB state so
    // preserved MANUAL_OVERRIDE/reconciled rows keep counting as classified.
    const [classifiedInBatch, needsReviewInBatch, unmatchedInBatch] =
      await Promise.all([
        this.prisma.transaction.count({
          where: {
            condominiumId,
            importBatchId: batchId,
            classificationStatus: {
              in: [ClassificationStatus.AUTO, ClassificationStatus.MANUAL_OVERRIDE],
            },
          },
        }),
        this.prisma.transaction.count({
          where: {
            condominiumId,
            importBatchId: batchId,
            classificationStatus: ClassificationStatus.NEEDS_REVIEW,
          },
        }),
        this.prisma.transaction.count({
          where: {
            condominiumId,
            importBatchId: batchId,
            classificationStatus: ClassificationStatus.NEEDS_REVIEW,
            residentId: null,
          },
        }),
      ]);
    await this.prisma.importBatch.updateMany({
      where: { id: batchId, condominiumId },
      data: {
        status: 'COMPLETED',
        completedAt: batch.completedAt ?? new Date(),
        classifiedCount: classifiedInBatch,
        needsReviewCount: needsReviewInBatch,
        unmatchedCount: unmatchedInBatch,
        classifiedAt: new Date(),
      },
    });

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'BATCH_RECLASSIFIED',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'ImportBatch',
          entityId: batchId,
          beforeState: { counts: beforeSummary },
          afterState: {
            total: summary.total,
            classified: summary.classified,
            needsReview: summary.needsReview,
            unmatched: summary.unmatched,
            skipped: summary.skipped,
            preservedManual,
          },
          result: 'SUCCESS',
          description: `Batch reclassified: ${summary.total} transactions processed, ${preservedManual} preserved`,
        },
      });
    }

    return { ...summary, preservedManual };
  }

  /**
   * Reclassify every transaction in the tenant that is awaiting review
   * (`classificationStatus=NEEDS_REVIEW` + `reconciliationStatus=PENDING`)
   * using the current set of active reconciliation rules.
   *
   * Designed to be called after the admin modifies rules: a row that newly
   * matches a rule becomes AUTO, the rest stays NEEDS_REVIEW. Monthly
   * summaries for the affected periods are recomputed at the end.
   */
  async reapplyToPending(
    condominiumId: string,
    actorUserId: string | null,
  ): Promise<ClassificationSummary> {
    // Phase 6 (A4 + A5): shared cursor-batched candidate loading + cached
    // terrace keywords; only the PENDING-review transactions query is specific
    // to this re-apply path.
    const [
      { residents, activeRules, terraceEvents, terraceGlobalKeywords, totalUnits, ordinaryFeeAmount, lateFeeAmount },
      transactions,
      correctionPatterns,
    ] = await Promise.all([
        this.loadCandidates(condominiumId),
        this.prisma.transaction.findMany({
          where: {
            condominiumId,
            classificationStatus: ClassificationStatus.NEEDS_REVIEW,
            reconciliationStatus: ReconciliationStatus.PENDING,
          },
          select: {
            id: true,
            description: true,
            transactionDate: true,
            credits: true,
            charges: true,
            flowType: true,
            // Pending rows span multiple batches/banks, so the dialect is read
            // per transaction (not once like classifyBatch). ENGINE-009: the
            // validated field, never the free-text bankName.
            importBatch: { select: { bankProfile: { select: { dialect: true } } } },
          },
        }),
        this.loadCorrectionPatterns(condominiumId),
      ]);

    let classified = 0;
    let needsReview = 0;
    let unmatched = 0;
    let skipped = 0;

    const affectedMonths = new Set<string>();

    const CHUNK = 200;
    for (let i = 0; i < transactions.length; i += CHUNK) {
      const chunk = transactions.slice(i, i + CHUNK);
      const nowForChunk = new Date();

      const groups = new Map<
        string,
        { ids: string[]; data: Prisma.TransactionUncheckedUpdateManyInput }
      >();

      for (const tx of chunk) {
        const terraceContext =
          tx.flowType === 'INCOME' && terraceEvents.length > 0
            ? {
                events: terraceEvents,
                amount: tx.credits ? Number(tx.credits) : null,
                transactionDate: new Date(tx.transactionDate),
                globalKeywords: terraceGlobalKeywords,
              }
            : undefined;

        const txDialect = tx.importBatch?.bankProfile?.dialect ?? BankDialect.GENERIC;
        const maintenanceContext =
          tx.flowType === 'INCOME' && txDialect === BankDialect.BANBAJIO
            ? { amount: tx.credits ? Number(tx.credits) : null, ordinaryFeeAmount, lateFeeAmount }
            : undefined;

        const result = classifyTransaction(
          tx.description,
          new Date(tx.transactionDate),
          residents,
          activeRules,
          terraceContext,
          { dialect: txDialect, totalUnits },
          maintenanceContext,
          tx.flowType,
          correctionPatterns,
        );

        const data: Prisma.TransactionUncheckedUpdateManyInput = {
          unitNumberDetected: result.unitNumberDetected,
          unitNumbersDetected: result.unitNumbersDetected,
          payerNameDetected: result.payerNameDetected,
          paymentConcept: result.paymentConcept,
          expenseCategoryId: result.expenseCategoryId ?? null,
          supplierId: result.supplierId ?? null,
          paymentPeriodYear: result.paymentPeriodYear,
          paymentPeriodMonth: result.paymentPeriodMonth,
          matchSource: result.matchSource,
          matchedPatternLabel: result.matchedPatternLabel ?? null,
          confidenceScore: result.confidenceScore
            ? new Prisma.Decimal(result.confidenceScore.toFixed(4))
            : null,
          matchedAt: result.matchedAt ? nowForChunk : null,
          residentId: result.residentId,
          classificationStatus: result.classificationStatus,
          requiresReviewReason: result.requiresReviewReason ?? null,
          matchedRuleId: result.matchedRuleId ?? null,
          matchedCalendarEventId: result.matchedCalendarEventId ?? null,
          classificationVersion: { increment: 1 },
        };

        const key = JSON.stringify(data, (_k, v) =>
          v instanceof Prisma.Decimal ? v.toString() : v,
        );
        const existing = groups.get(key);
        if (existing) {
          existing.ids.push(tx.id);
        } else {
          groups.set(key, { ids: [tx.id], data });
        }

        const d = new Date(tx.transactionDate);
        affectedMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
      }

      // ENGINE-018: re-assert the candidate predicate at write time — a row
      // manually classified or reconciled while this run was computing is
      // skipped and reported, never overwritten. Counters come from the
      // write counts so the summary reflects what actually persisted.
      const groupList = Array.from(groups.values());
      const results = await this.prisma.$transaction(
        groupList.map(({ ids, data }) =>
          this.prisma.transaction.updateMany({
            where: {
              condominiumId,
              id: { in: ids },
              classificationStatus: ClassificationStatus.NEEDS_REVIEW,
              reconciliationStatus: ReconciliationStatus.PENDING,
            },
            data,
          }),
        ),
      );
      groupList.forEach(({ ids, data }, idx) => {
        const count = results[idx].count;
        if (data.classificationStatus === ClassificationStatus.AUTO) {
          classified += count;
        } else {
          needsReview += count;
          if (data.residentId === null) unmatched += count;
        }
        skipped += ids.length - count;
      });
    }

    // Recompute monthly summaries for every period that had at least one
    // touched transaction. classifyBatch does this scoped by batchId; here
    // we span batches but the per-month aggregation is the same.
    await this.summaries.recomputeMonths(condominiumId, affectedMonths);

    if (actorUserId) {
      await this.prisma.auditLog.create({
        data: {
          condominiumId,
          userId: actorUserId,
          action: 'RULES_REAPPLIED_TO_PENDING',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'Condominium',
          entityId: condominiumId,
          afterState: {
            total: transactions.length,
            classified,
            needsReview,
            unmatched,
            skipped,
          },
          result: 'SUCCESS',
          description: `Reapplied rules to ${transactions.length} pending transactions: ${classified} classified, ${needsReview} still need review, ${skipped} skipped (concurrent edits)`,
        },
      });
    }

    return { total: transactions.length, classified, needsReview, unmatched, skipped };
  }
}
