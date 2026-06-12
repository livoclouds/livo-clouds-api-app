import { BadRequestException, ConflictException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MatchSource, ClassificationStatus, RequiresReviewReason, ReconciliationStatus, FlowType, BankDialect, Prisma } from '@prisma/client';
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
import { round2, toCents } from '../../common/utils/money.util';
import { summaryLockKey, upsertSummaryForMonthCore } from './monthly-summary.util';
import {
  buildSystemRulesCatalog,
  normalizeText,
  type ClassificationResult,
  type ClassificationSummary,
  type CorrectionPatternData,
  type DbRule,
  type ResidentData,
  type SystemRulesCatalog,
} from './engine/extraction.util';
import { classifyTransaction as classifyTransactionFn } from './engine/transaction-classifier';

// ENGINE-008 decomposition (Phase 6): the pure extraction/matching engine and
// the per-row classifier moved to ./engine/. Re-exported here so every
// existing import path (specs, imports.service, controllers) stays valid.
export {
  CONCEPT_PATTERNS,
  PAYER_PATTERNS,
  SYSTEM_BEHAVIORAL_PASSES,
  UNIT_PATTERNS,
  extractFromBanBajio,
  extractFromText,
  parseMaintenanceConcept,
  resolveNearestCycle,
  resolveRuleUnit,
} from './engine/extraction.util';
export type {
  ClassificationResult,
  ClassificationSummary,
  CorrectionPatternData,
  DbRule,
  SystemRulesCatalog,
} from './engine/extraction.util';

/**
 * Phase 6 (A4): page size for cursor-batched loading of classification
 * candidate sets (residents, terrace bookings). The matcher needs the complete
 * set in memory, so this bounds the per-query result/driver buffer — not the
 * working set. A small condominium returns a single page (< pageSize) and stops
 * after one round, so behavior is unchanged for the common case.
 */
const CANDIDATE_PAGE_SIZE = 500;

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ReconciliationRulesService))
    private readonly rulesService: ReconciliationRulesService,
    private readonly events: EventEmitter2,
    private readonly settingsCache: SettingsCacheService,
  ) {}


  /**
   * Returns a read-only catalog of the engine's hardcoded logic (concept keywords,
   * unit prefixes, recognized months, behavioral passes), derived directly from the
   * engine constants. Consumed by GET …/reconciliation-rules/system so the UI can
   * show the "reglas del sistema" (built-in, non-editable) next to the editable
   * Pass-0 rules — making the classification engine fully transparent.
   */
  getSystemRulesCatalog(): SystemRulesCatalog {
    return buildSystemRulesCatalog();
  }

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


  classifyTransaction(
    description: string,
    transactionDate: Date,
    residents: ResidentData[],
    rules: DbRule[] = [],
    terraceContext?: {
      events: TerraceCandidate[];
      amount: number | null;
      transactionDate: Date;
      detectedResidentId?: string | null;
      // Phase 5F (KI-004): tenant-level keywords loaded once per batch from
      // CondominiumSettings.terraceGlobalKeywords and threaded through.
      globalKeywords?: string[];
    },
    // Bank extraction strategy + unit bound. `dialect` comes from the batch's
    // bank profile (ENGINE-009 — a validated field, never a bankName substring);
    // `totalUnits` from CondominiumSettings.
    bankContext?: { dialect: BankDialect; totalUnits: number },
    // Maintenance-fee pass inputs. Provided only for INCOME transactions on a
    // BANBAJIO-dialect batch; `amount` is the credit, the fees come from
    // CondominiumSettings.
    maintenanceContext?: {
      amount: number | null;
      ordinaryFeeAmount: number;
      lateFeeAmount: number;
    },
    // Drives which rule kinds apply (EXPENSE rules on outflows, CONCEPT/UNIT on
    // inflows). Defaults to INCOME so existing callers/tests stay unchanged.
    flowType: FlowType = FlowType.INCOME,
    // ENGINE-043: recurring manual corrections (occurrenceCount >= 2) keyed by
    // normalized description, loaded once per batch/reapply run. Optional so
    // existing callers/tests stay unchanged.
    correctionPatterns?: Map<string, CorrectionPatternData>,
  ): ClassificationResult {
    return classifyTransactionFn(
      description,
      transactionDate,
      residents,
      rules,
      terraceContext,
      bankContext,
      maintenanceContext,
      flowType,
      correctionPatterns,
    );
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

        const result = this.classifyTransaction(
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

    await this.upsertMonthlySummaries(condominiumId, batchId);

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

        const result = this.classifyTransaction(
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
    await this.recomputeMonths(condominiumId, affectedMonths);

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

  async manualMatch(
    condominiumId: string,
    transactionId: string,
    residentId: string,
    userId: string,
  ): Promise<void> {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
    });
    if (!resident) {
      throw new NotFoundException('Resident not found in this condominium');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          residentId: true,
          matchSource: true,
          matchedPatternLabel: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
        },
      });
      if (!existing) throw new NotFoundException('Transaction not found');

      const result = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: existing.updatedAt,
        },
        data: {
          residentId,
          matchSource: MatchSource.MANUAL,
          matchedPatternLabel: null,
          confidenceScore: new Prisma.Decimal('1.0000'),
          matchedAt: new Date(),
          classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
          requiresReviewReason: null,
          matchedRuleId: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      // A single-resident link supersedes any prior multi-unit split; stale
      // allocations would keep paying the old residents (ENGINE-006).
      await tx.paymentAllocation.deleteMany({
        where: { transactionId, condominiumId },
      });

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_MATCHED_MANUALLY',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: {
            residentId: existing.residentId,
            matchSource: existing.matchSource,
            // ENGINE-042: keep the pattern attribution in the audit trail so the
            // metrics service can slice override rates per pattern.
            matchedPatternLabel: existing.matchedPatternLabel,
            classificationStatus: existing.classificationStatus,
            requiresReviewReason: existing.requiresReviewReason,
            matchedRuleId: existing.matchedRuleId,
          },
          afterState: {
            residentId,
            matchSource: MatchSource.MANUAL,
            classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
            requiresReviewReason: null,
            matchedRuleId: null,
          },
          result: 'SUCCESS',
        },
      });
    });
  }

  async manualClassify(
    condominiumId: string,
    transactionId: string,
    dto: {
      unitNumber?: string;
      allocations?: {
        unitNumber: string;
        residentId: string;
        allocatedAmount: number;
      }[];
      paymentConcept?: string;
      expenseCategoryId?: string;
      supplierId?: string;
      paymentPeriodMonth?: number;
      paymentPeriodYear?: number;
      transactionDate?: string;
      description?: string;
    },
    userId: string,
  ): Promise<void> {
    // Multi-house payment: split the credit across several units via
    // PaymentAllocation rows instead of a single resident link.
    if (dto.allocations && dto.allocations.length > 0) {
      return this.manualClassifyWithAllocations(condominiumId, transactionId, dto, userId);
    }

    // REV-004: strict resident resolution.
    // `residentId === undefined` means the dto did not touch the unit (no update),
    // `null` means admin explicitly cleared the unit, a string means resolved match.
    // An unresolved non-empty unitNumber raises 400 UNIT_NOT_FOUND so admin typos
    // never silently break a correctly matched transaction.
    let residentId: string | null | undefined;
    if (dto.unitNumber === '') {
      residentId = null;
    } else if (dto.unitNumber) {
      const resident = await this.prisma.resident.findFirst({
        where: { condominiumId, unitNumber: dto.unitNumber, deletedAt: null },
        select: { id: true },
      });
      if (!resident) {
        throw new BadRequestException({
          code: 'UNIT_NOT_FOUND',
          reason: `Unit "${dto.unitNumber}" does not match any resident in this condominium.`,
          field: 'unitNumber',
          unitNumber: dto.unitNumber,
        });
      }
      residentId = resident.id;
    }

    // Tenant-scope guard: a category/supplier id, when provided non-empty, must
    // belong to this condominium before it can be stamped on the transaction.
    if (dto.expenseCategoryId) {
      const cat = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.expenseCategoryId, condominiumId, deletedAt: null },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException({
          code: 'EXPENSE_CATEGORY_NOT_FOUND',
          reason: 'Expense category does not belong to this condominium.',
          field: 'expenseCategoryId',
        });
      }
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, condominiumId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException({
          code: 'SUPPLIER_NOT_FOUND',
          reason: 'Supplier does not belong to this condominium.',
          field: 'supplierId',
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          description: true,
          residentId: true,
          unitNumberDetected: true,
          paymentConcept: true,
          expenseCategoryId: true,
          supplierId: true,
          paymentPeriodMonth: true,
          paymentPeriodYear: true,
          transactionDate: true,
          matchSource: true,
          matchedPatternLabel: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
          paymentAllocations: {
            select: { residentId: true, unitNumber: true, allocatedAmount: true },
          },
        },
      });
      if (!existingTx) throw new NotFoundException('Transaction not found');

      const result = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: existingTx.updatedAt,
        },
        data: {
          // ENGINE-021: the scalar/array pair moves together — a single-unit
          // re-link must not leave a stale multi-unit array behind (the DB
          // CHECK constraint now enforces this invariant structurally).
          ...(dto.unitNumber !== undefined && {
            unitNumberDetected: dto.unitNumber || null,
            unitNumbersDetected: dto.unitNumber ? [dto.unitNumber] : [],
          }),
          ...(dto.paymentConcept !== undefined && { paymentConcept: dto.paymentConcept || null }),
          ...(dto.expenseCategoryId !== undefined && { expenseCategoryId: dto.expenseCategoryId || null }),
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId || null }),
          ...(dto.paymentPeriodMonth !== undefined && { paymentPeriodMonth: dto.paymentPeriodMonth }),
          ...(dto.paymentPeriodYear !== undefined && { paymentPeriodYear: dto.paymentPeriodYear }),
          ...(dto.transactionDate !== undefined && { transactionDate: new Date(dto.transactionDate) }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(residentId !== undefined && { residentId }),
          matchSource: MatchSource.MANUAL,
          matchedPatternLabel: null,
          confidenceScore: new Prisma.Decimal('1.0000'),
          matchedAt: new Date(),
          classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
          requiresReviewReason: null,
          matchedRuleId: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      // Re-linking to a single unit supersedes any prior multi-unit split.
      // Concept/period-only edits (unitNumber undefined) must NOT touch a
      // valid split — only linkage rewrites clean up (ENGINE-006).
      if (dto.unitNumber !== undefined) {
        await tx.paymentAllocation.deleteMany({
          where: { transactionId, condominiumId },
        });
      }

      const descriptionForPattern = dto.description ?? existingTx.description;
      // ENGINE-043 hygiene: only record corrections that carry an outcome the
      // learned-correction pass can re-apply. A concept/period-only edit with
      // no unit/resident/concept would mint an empty pattern that can never fire.
      const hasLearnableOutcome =
        (dto.unitNumber !== undefined && dto.unitNumber !== '') ||
        (residentId !== undefined && residentId !== null) ||
        (dto.paymentConcept !== undefined && dto.paymentConcept !== '');
      if (descriptionForPattern && hasLearnableOutcome) {
        await tx.reconciliationCorrectionPattern.upsert({
          where: {
            condominiumId_originalDescription: {
              condominiumId,
              originalDescription: descriptionForPattern,
            },
          },
          create: {
            condominiumId,
            originalDescription: descriptionForPattern,
            selectedUnitNumber: dto.unitNumber ?? null,
            selectedResidentId: residentId ?? null,
            selectedConcept: dto.paymentConcept ?? null,
            occurrenceCount: 1,
            lastSeenAt: new Date(),
          },
          update: {
            selectedUnitNumber: dto.unitNumber ?? null,
            selectedResidentId: residentId ?? null,
            selectedConcept: dto.paymentConcept ?? null,
            occurrenceCount: { increment: 1 },
            lastSeenAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_CLASSIFIED_MANUALLY',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: {
            residentId: existingTx.residentId,
            unitNumberDetected: existingTx.unitNumberDetected,
            paymentConcept: existingTx.paymentConcept,
            expenseCategoryId: existingTx.expenseCategoryId,
            supplierId: existingTx.supplierId,
            paymentPeriodMonth: existingTx.paymentPeriodMonth,
            paymentPeriodYear: existingTx.paymentPeriodYear,
            transactionDate: existingTx.transactionDate,
            matchSource: existingTx.matchSource,
            // ENGINE-042: pattern attribution survives in the audit trail.
            matchedPatternLabel: existingTx.matchedPatternLabel,
            classificationStatus: existingTx.classificationStatus,
            requiresReviewReason: existingTx.requiresReviewReason,
            matchedRuleId: existingTx.matchedRuleId,
            // Splits removed by a single-unit re-link (ENGINE-006 cleanup).
            ...(dto.unitNumber !== undefined &&
              (existingTx.paymentAllocations?.length ?? 0) > 0 && {
                removedAllocations: existingTx.paymentAllocations.map((a) => ({
                  residentId: a.residentId,
                  unitNumber: a.unitNumber,
                  allocatedAmount: Number(a.allocatedAmount),
                })),
              }),
          },
          afterState: {
            residentId: residentId !== undefined ? residentId : (existingTx.residentId ?? null),
            unitNumberDetected: dto.unitNumber !== undefined ? (dto.unitNumber || null) : existingTx.unitNumberDetected,
            // ENGINE-021: array kept in lockstep with the scalar above.
            ...(dto.unitNumber !== undefined && {
              unitNumbersDetected: dto.unitNumber ? [dto.unitNumber] : [],
            }),
            paymentConcept: dto.paymentConcept !== undefined ? (dto.paymentConcept || null) : existingTx.paymentConcept,
            expenseCategoryId: dto.expenseCategoryId !== undefined ? (dto.expenseCategoryId || null) : existingTx.expenseCategoryId,
            supplierId: dto.supplierId !== undefined ? (dto.supplierId || null) : existingTx.supplierId,
            paymentPeriodMonth: dto.paymentPeriodMonth !== undefined ? dto.paymentPeriodMonth : existingTx.paymentPeriodMonth,
            paymentPeriodYear: dto.paymentPeriodYear !== undefined ? dto.paymentPeriodYear : existingTx.paymentPeriodYear,
            transactionDate: dto.transactionDate !== undefined ? new Date(dto.transactionDate) : existingTx.transactionDate,
            matchSource: MatchSource.MANUAL,
            classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
            requiresReviewReason: null,
            matchedRuleId: null,
          },
          result: 'SUCCESS',
        },
      });
    });
  }

  /**
   * Splits a single credit across several houses (PaymentAllocation rows). Used
   * for BanBajío payments whose concept names more than one unit ("casas 307 y
   * 43"). The transaction itself keeps no single residentId — each resident is
   * credited their slice via an allocation, and per-resident balances read those
   * allocations (see CollectionService.getAccountStatement). Re-editing replaces
   * the prior allocations wholesale (delete-and-recreate) so it stays idempotent.
   */
  private async manualClassifyWithAllocations(
    condominiumId: string,
    transactionId: string,
    dto: {
      allocations?: {
        unitNumber: string;
        residentId: string;
        allocatedAmount: number;
      }[];
      paymentConcept?: string;
      paymentPeriodMonth?: number;
      paymentPeriodYear?: number;
      transactionDate?: string;
      description?: string;
    },
    userId: string,
  ): Promise<void> {
    const allocations = dto.allocations ?? [];
    const settings = await this.settingsCache.getSettings(condominiumId);
    const totalUnits = settings?.totalUnits ?? 0;

    await this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          description: true,
          credits: true,
          residentId: true,
          unitNumberDetected: true,
          unitNumbersDetected: true,
          paymentConcept: true,
          paymentPeriodMonth: true,
          paymentPeriodYear: true,
          transactionDate: true,
          matchSource: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
          paymentAllocations: {
            select: { unitNumber: true, residentId: true, allocatedAmount: true },
          },
        },
      });
      if (!existingTx) throw new NotFoundException('Transaction not found');

      const credit = existingTx.credits ? Number(existingTx.credits) : 0;
      if (credit <= 0) {
        throw new BadRequestException({
          code: 'ALLOCATION_NOT_INCOME',
          reason: 'Only an income transaction with a credit amount can be split across units.',
        });
      }

      // Amounts must sum to the credit EXACTLY, compared in integer cents
      // (ENGINE-052: the previous ±$0.01 tolerance persisted one-cent drifts).
      const sumCents = allocations.reduce(
        (acc, a) => acc + toCents(Number(a.allocatedAmount)),
        0,
      );
      const sum = sumCents / 100;
      if (sumCents !== toCents(credit)) {
        throw new BadRequestException({
          code: 'ALLOCATION_SUM_MISMATCH',
          reason: `Allocations must sum to the transaction credit (${credit.toFixed(2)}); got ${sum.toFixed(2)}.`,
          field: 'allocations',
          expected: credit,
          received: sum,
        });
      }

      // Each unit must be in range and each resident must actually live in it.
      for (const a of allocations) {
        const n = parseInt(a.unitNumber, 10);
        if (!Number.isFinite(n) || n < 1 || totalUnits <= 0 || n > totalUnits) {
          throw new BadRequestException({
            code: 'ALLOCATION_UNIT_OUT_OF_RANGE',
            reason: `Unit "${a.unitNumber}" is outside the configured range (1..${totalUnits}).`,
            field: 'allocations',
            unitNumber: a.unitNumber,
          });
        }
        const resident = await tx.resident.findFirst({
          where: { id: a.residentId, condominiumId, unitNumber: a.unitNumber, deletedAt: null },
          select: { id: true },
        });
        if (!resident) {
          throw new BadRequestException({
            code: 'ALLOCATION_RESIDENT_UNIT_MISMATCH',
            reason: `Resident does not match unit "${a.unitNumber}" in this condominium.`,
            field: 'allocations',
            unitNumber: a.unitNumber,
            residentId: a.residentId,
          });
        }
      }

      const periodMonth = dto.paymentPeriodMonth ?? existingTx.paymentPeriodMonth;
      const periodYear = dto.paymentPeriodYear ?? existingTx.paymentPeriodYear;
      const txDate = dto.transactionDate ? new Date(dto.transactionDate) : existingTx.transactionDate;
      const units = allocations.map((a) => a.unitNumber);

      const result = await tx.transaction.updateMany({
        where: { id: transactionId, condominiumId, updatedAt: existingTx.updatedAt },
        data: {
          // No single resident owns a split payment; the array carries the houses.
          residentId: null,
          unitNumberDetected: null,
          unitNumbersDetected: units,
          ...(dto.paymentConcept !== undefined && { paymentConcept: dto.paymentConcept || null }),
          ...(dto.paymentPeriodMonth !== undefined && { paymentPeriodMonth: dto.paymentPeriodMonth }),
          ...(dto.paymentPeriodYear !== undefined && { paymentPeriodYear: dto.paymentPeriodYear }),
          ...(dto.transactionDate !== undefined && { transactionDate: new Date(dto.transactionDate) }),
          ...(dto.description !== undefined && { description: dto.description }),
          matchSource: MatchSource.MANUAL,
          confidenceScore: new Prisma.Decimal('1.0000'),
          matchedAt: new Date(),
          classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
          requiresReviewReason: null,
          matchedRuleId: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      // Delete-and-recreate keeps re-edits idempotent.
      await tx.paymentAllocation.deleteMany({ where: { transactionId } });
      await tx.paymentAllocation.createMany({
        data: allocations.map((a) => ({
          condominiumId,
          transactionId,
          residentId: a.residentId,
          unitNumber: a.unitNumber,
          paymentPeriodYear: periodYear ?? txDate.getUTCFullYear(),
          paymentPeriodMonth: periodMonth ?? txDate.getUTCMonth() + 1,
          allocatedAmount: new Prisma.Decimal(round2(Number(a.allocatedAmount)).toFixed(2)),
        })),
      });

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_CLASSIFIED_MANUALLY',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: {
            residentId: existingTx.residentId,
            unitNumberDetected: existingTx.unitNumberDetected,
            unitNumbersDetected: existingTx.unitNumbersDetected,
            classificationStatus: existingTx.classificationStatus,
            allocations: existingTx.paymentAllocations.map((a) => ({
              unitNumber: a.unitNumber,
              residentId: a.residentId,
              allocatedAmount: Number(a.allocatedAmount),
            })),
          },
          afterState: {
            residentId: null,
            unitNumberDetected: null,
            unitNumbersDetected: units,
            classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
            allocations: allocations.map((a) => ({
              unitNumber: a.unitNumber,
              residentId: a.residentId,
              allocatedAmount: Number(a.allocatedAmount),
            })),
          },
          result: 'SUCCESS',
        },
      });
    });
  }

  async unmatch(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          residentId: true,
          matchSource: true,
          matchedPatternLabel: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
        },
      });
      if (!existing) throw new NotFoundException('Transaction not found');

      const result = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: existing.updatedAt,
        },
        data: {
          residentId: null,
          matchSource: null,
          matchedPatternLabel: null,
          confidenceScore: null,
          matchedAt: null,
          classificationStatus: ClassificationStatus.NEEDS_REVIEW,
          requiresReviewReason: RequiresReviewReason.MANUAL_UNMATCHED,
          matchedRuleId: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      // Unlinked means zero allocations — a surviving split would keep paying
      // residents out of a transaction that belongs to no one (ENGINE-006).
      await tx.paymentAllocation.deleteMany({
        where: { transactionId, condominiumId },
      });

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_UNMATCHED',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: {
            residentId: existing.residentId,
            matchSource: existing.matchSource,
            // ENGINE-042: pattern attribution survives in the audit trail.
            matchedPatternLabel: existing.matchedPatternLabel,
            classificationStatus: existing.classificationStatus,
            requiresReviewReason: existing.requiresReviewReason,
            matchedRuleId: existing.matchedRuleId,
          },
          afterState: {
            residentId: null,
            matchSource: null,
            classificationStatus: ClassificationStatus.NEEDS_REVIEW,
            requiresReviewReason: RequiresReviewReason.MANUAL_UNMATCHED,
            matchedRuleId: null,
          },
          result: 'SUCCESS',
        },
      });
    });
  }

  private async upsertMonthlySummaries(
    condominiumId: string,
    batchId: string,
  ): Promise<void> {
    const periods = await this.prisma.transaction.groupBy({
      by: ['transactionDate'],
      where: { condominiumId, importBatchId: batchId },
    });

    const uniqueMonths = new Set<string>();
    for (const { transactionDate } of periods) {
      const d = new Date(transactionDate);
      uniqueMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
    }

    await this.recomputeMonths(condominiumId, uniqueMonths);
  }

  // ENGINE-002 — public recompute for callers that delete transactions and
  // must rebuild the official monthly numbers afterwards (imports remove()).
  // The month list is captured by the caller BEFORE deleting, because the
  // batch-scoped variant derives its months from rows that no longer exist.
  async recomputeSummariesForMonths(
    condominiumId: string,
    months: Array<{ year: number; month: number }>,
  ): Promise<void> {
    await this.recomputeMonths(
      condominiumId,
      months.map(({ year, month }) => `${year}-${month}`),
    );
  }

  // ENGINE-002 — revert terrace bookings marked PAID by transactions of the
  // given batch. Called by imports remove() before hard-deleting the rows so
  // a booking never stays PAID with its proof transaction gone.
  async revertTerraceLinksForBatch(
    condominiumId: string,
    batchId: string,
    userId: string,
  ): Promise<void> {
    const linked = await this.prisma.transaction.findMany({
      where: {
        condominiumId,
        importBatchId: batchId,
        matchedCalendarEventId: { not: null },
      },
      select: { id: true, matchedCalendarEventId: true },
    });
    for (const tx of linked) {
      if (!tx.matchedCalendarEventId) continue;
      await this.unmarkTerraceEventPaid(
        tx.matchedCalendarEventId,
        tx.id,
        condominiumId,
        userId,
      );
    }
  }

  private async upsertSummaryForMonth(
    condominiumId: string,
    year: number,
    month: number,
  ): Promise<void> {
    // ENGINE-022 — the six reads + upsert run inside one transaction,
    // serialized per (tenant, month) by a Postgres advisory xact-lock
    // (first advisory-lock use in this codebase). $transaction alone is
    // READ COMMITTED — each statement takes its own snapshot — so without
    // the lock two concurrent recomputes could persist internally
    // inconsistent counts (pending+approved+ignored ≠ transactionCount).
    // pg_advisory_xact_lock(int4, int4): key1 = hashtext(condominiumId),
    // key2 = year*100+month; auto-released at commit/rollback.
    await this.prisma.$transaction(async (tx) => {
      // ::int4 cast — Prisma binds JS numbers as bigint and the two-arg lock
      // only exists as (int4, int4). $executeRaw, not $queryRaw: the lock
      // returns void, which Prisma's result deserializer rejects.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${condominiumId}), ${summaryLockKey(year, month)}::int4)`;
      await upsertSummaryForMonthCore(tx, condominiumId, year, month);
    });
  }

  /**
   * Coalesced month recompute (ENGINE-039): dedupes the month keys and runs
   * the recomputes SEQUENTIALLY — a request touches 1-13 months at most, and
   * a parallel fan-out would only queue on the advisory lock while exhausting
   * the connection pool.
   */
  private async recomputeMonths(
    condominiumId: string,
    monthKeys: Iterable<string>,
  ): Promise<void> {
    for (const key of new Set(monthKeys)) {
      const [year, month] = key.split('-').map(Number);
      await this.upsertSummaryForMonth(condominiumId, year, month);
    }
  }

  // ENGINE-020: approve mirrors reopen's guarded pattern — explicit
  // state-transition check (only PENDING rows can be approved), optimistic
  // lock on updatedAt, and all side effects (terrace marking, audit log)
  // inside one transaction. The summary recompute stays post-commit: it is
  // derived data, recomputable, and serialized by its own advisory lock.
  async approveTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    let capturedDate: Date | undefined;

    await this.prisma.$transaction(async (prisma) => {
      const tx = await prisma.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          transactionDate: true,
          reconciliationStatus: true,
          matchedCalendarEventId: true,
          updatedAt: true,
        },
      });
      if (!tx) throw new NotFoundException('Transaction not found');

      if (tx.reconciliationStatus !== ReconciliationStatus.PENDING) {
        throw new BadRequestException({
          code: 'INVALID_STATE_TRANSITION',
          reason: `Transaction is ${tx.reconciliationStatus} — reopen it before changing its reconciliation outcome.`,
        });
      }

      capturedDate = tx.transactionDate;
      const before = { reconciliationStatus: tx.reconciliationStatus };
      const now = new Date();

      const result = await prisma.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: tx.updatedAt,
          reconciliationStatus: ReconciliationStatus.PENDING,
        },
        data: {
          reconciliationStatus: ReconciliationStatus.APPROVED,
          reconciledById: userId,
          reconciledAt: now,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      // When a terrace booking was linked, mark it as PAID on approval.
      if (tx.matchedCalendarEventId) {
        await this.markTerraceEventPaid(
          tx.matchedCalendarEventId,
          transactionId,
          condominiumId,
          userId,
          prisma,
        );
      }

      await prisma.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_APPROVED',
          actionCategory: 'RECONCILIATION',
          module: 'transactions',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: before,
          afterState: { reconciliationStatus: ReconciliationStatus.APPROVED },
          result: 'SUCCESS',
        },
      });
    });

    const d = new Date(capturedDate!);
    await this.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);
  }

  // `client` lets the helper join a caller's transaction (ENGINE-019/020);
  // it defaults to the root client for standalone use.
  private async markTerraceEventPaid(
    calendarEventId: string,
    transactionId: string,
    condominiumId: string,
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const ev = await client.calendarEvent.findFirst({
      where: { id: calendarEventId, condominiumId, deletedAt: null },
      select: { metadata: true },
    });
    if (!ev) {
      this.logger.warn(
        `markTerraceEventPaid: event ${calendarEventId} not found or deleted — skipping payment status update`,
      );
      return;
    }

    const validation = validateTerraceMetadata(ev.metadata);
    if (!validation.valid) {
      this.logger.warn(
        `markTerraceEventPaid: corrupt metadata on event ${calendarEventId} — ${validation.error}`,
      );
      return;
    }
    if (validation.data.paymentStatus === 'PAID') {
      this.logger.debug(
        `markTerraceEventPaid: event ${calendarEventId} already PAID — skipping`,
      );
      return;
    }

    const updatedMetadata = { ...validation.data, paymentStatus: 'PAID' as const };

    await client.calendarEvent.update({
      where: { id: calendarEventId },
      data: { metadata: updatedMetadata as unknown as Prisma.InputJsonValue },
    });

    await client.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: 'TERRACE_BOOKING_MARKED_PAID',
        actionCategory: 'RECONCILIATION',
        module: 'calendar',
        entityType: 'CalendarEvent',
        entityId: calendarEventId,
        beforeState: { paymentStatus: validation.data.paymentStatus },
        afterState: { paymentStatus: 'PAID', linkedTransactionId: transactionId },
        result: 'SUCCESS',
        description: `Terrace booking payment confirmed via transaction ${transactionId}`,
      },
    });
  }

  private async unmarkTerraceEventPaid(
    calendarEventId: string,
    transactionId: string,
    condominiumId: string,
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const ev = await client.calendarEvent.findFirst({
      where: { id: calendarEventId, condominiumId, deletedAt: null },
      select: { metadata: true },
    });
    if (!ev) {
      this.logger.warn(
        `unmarkTerraceEventPaid: event ${calendarEventId} not found or deleted — skipping revert`,
      );
      return;
    }

    const validation = validateTerraceMetadata(ev.metadata);
    if (!validation.valid) {
      this.logger.warn(
        `unmarkTerraceEventPaid: corrupt metadata on event ${calendarEventId} — ${validation.error}`,
      );
      return;
    }
    if (validation.data.paymentStatus === 'PENDING') {
      this.logger.debug(
        `unmarkTerraceEventPaid: event ${calendarEventId} already PENDING — skipping`,
      );
      return;
    }

    const updatedMetadata = { ...validation.data, paymentStatus: 'PENDING' as const };

    await client.calendarEvent.update({
      where: { id: calendarEventId },
      data: { metadata: updatedMetadata as unknown as Prisma.InputJsonValue },
    });

    await client.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: 'TERRACE_BOOKING_PAYMENT_REVERTED',
        actionCategory: 'RECONCILIATION',
        module: 'calendar',
        entityType: 'CalendarEvent',
        entityId: calendarEventId,
        beforeState: { paymentStatus: validation.data.paymentStatus },
        afterState: { paymentStatus: 'PENDING', linkedTransactionId: transactionId },
        result: 'SUCCESS',
        description: `Terrace booking payment reverted via transaction ${transactionId} reopen`,
      },
    });
  }

  // ENGINE-020: ignore is guarded exactly like approve — APPROVED→IGNORED
  // without an intermediate reopen returns INVALID_STATE_TRANSITION, and a
  // concurrent edit surfaces as STALE_OVERRIDE instead of last-write-wins.
  async ignoreTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    let capturedDate: Date | undefined;

    await this.prisma.$transaction(async (prisma) => {
      const tx = await prisma.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          transactionDate: true,
          reconciliationStatus: true,
          updatedAt: true,
        },
      });
      if (!tx) throw new NotFoundException('Transaction not found');

      if (tx.reconciliationStatus !== ReconciliationStatus.PENDING) {
        throw new BadRequestException({
          code: 'INVALID_STATE_TRANSITION',
          reason: `Transaction is ${tx.reconciliationStatus} — reopen it before changing its reconciliation outcome.`,
        });
      }

      capturedDate = tx.transactionDate;
      const before = { reconciliationStatus: tx.reconciliationStatus };
      const now = new Date();

      const result = await prisma.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: tx.updatedAt,
          reconciliationStatus: ReconciliationStatus.PENDING,
        },
        data: {
          reconciliationStatus: ReconciliationStatus.IGNORED,
          reconciledById: userId,
          reconciledAt: now,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      await prisma.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_IGNORED',
          actionCategory: 'RECONCILIATION',
          module: 'transactions',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: before,
          afterState: { reconciliationStatus: ReconciliationStatus.IGNORED },
          result: 'SUCCESS',
        },
      });
    });

    const d = new Date(capturedDate!);
    await this.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);
  }

  async reopenTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    let capturedDate: Date | undefined;
    let capturedCalendarEventId: string | null | undefined;

    await this.prisma.$transaction(async (prisma) => {
      const tx = await prisma.transaction.findFirst({
        where: { id: transactionId, condominiumId },
      });
      if (!tx) throw new NotFoundException('Transaction not found');

      if (tx.reconciliationStatus === ReconciliationStatus.PENDING) {
        throw new BadRequestException({
          code: 'INVALID_STATE_TRANSITION',
          reason: 'Transaction is already PENDING and cannot be reopened.',
        });
      }

      capturedDate = tx.transactionDate;
      capturedCalendarEventId = tx.matchedCalendarEventId;
      const before = { reconciliationStatus: tx.reconciliationStatus };

      const result = await prisma.transaction.updateMany({
        where: { id: transactionId, condominiumId, updatedAt: tx.updatedAt },
        data: {
          reconciliationStatus: ReconciliationStatus.PENDING,
          reconciledById: null,
          reconciledAt: null,
        },
      });

      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      await prisma.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_REOPENED',
          actionCategory: 'RECONCILIATION',
          module: 'transactions',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: before,
          afterState: { reconciliationStatus: ReconciliationStatus.PENDING },
          result: 'SUCCESS',
        },
      });
    });

    const d = new Date(capturedDate!);
    await this.recomputeMonths(condominiumId, [
      `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`,
    ]);

    if (capturedCalendarEventId) {
      await this.unmarkTerraceEventPaid(capturedCalendarEventId, transactionId, condominiumId, userId);
    }
  }

  // ENGINE-019: the bulk write asserts the expected current status (a bulk
  // approve no longer silently overrides a fresh IGNORE), terrace bookings
  // are marked PAID on bulk approve (parity with single approve), and every
  // side effect — terrace marking/revert, audit log — runs inside the same
  // transaction so a late failure rolls the whole batch back. Rows that
  // changed status concurrently are skipped and reported, not overwritten.
  async bulkReconcile(
    condominiumId: string,
    ids: string[],
    action: 'approve' | 'ignore' | 'reopen',
    userId: string,
  ): Promise<{ affected: number; skipped: number; requested: number }> {
    // Verify all IDs belong to this condominium (IDOR protection)
    const existing = await this.prisma.transaction.findMany({
      where: { id: { in: ids }, condominiumId },
      select: { id: true, transactionDate: true },
    });

    if (existing.length !== ids.length) {
      throw new ForbiddenException('One or more transactions do not belong to this condominium');
    }

    const statusMap: Record<string, ReconciliationStatus> = {
      approve: ReconciliationStatus.APPROVED,
      ignore: ReconciliationStatus.IGNORED,
      reopen: ReconciliationStatus.PENDING,
    };
    const newStatus = statusMap[action];
    const now = new Date();

    // approve/ignore only act on PENDING rows; reopen only on settled ones.
    const statusPrecondition =
      action === 'reopen'
        ? { not: ReconciliationStatus.PENDING }
        : ReconciliationStatus.PENDING;

    const actionMap: Record<string, string> = {
      approve: 'TRANSACTIONS_BULK_APPROVED',
      ignore: 'TRANSACTIONS_BULK_IGNORED',
      reopen: 'TRANSACTIONS_BULK_REOPENED',
    };

    let affected = 0;

    await this.prisma.$transaction(async (prisma) => {
      // Re-read eligibility inside the transaction so the terrace side
      // effects below act on the same row set the guarded write touches.
      const eligible = await prisma.transaction.findMany({
        where: { id: { in: ids }, condominiumId, reconciliationStatus: statusPrecondition },
        select: { id: true, reconciliationStatus: true, matchedCalendarEventId: true },
      });

      const result = await prisma.transaction.updateMany({
        where: {
          id: { in: eligible.map((t) => t.id) },
          condominiumId,
          reconciliationStatus: statusPrecondition,
        },
        data: {
          reconciliationStatus: newStatus,
          reconciledById: action === 'reopen' ? null : userId,
          reconciledAt: action === 'reopen' ? null : now,
        },
      });
      affected = result.count;

      if (action === 'approve') {
        // Terrace parity with single approve (ENGINE-019): linked bookings
        // are marked PAID in the same transaction as the approval.
        for (const t of eligible) {
          if (t.matchedCalendarEventId) {
            await this.markTerraceEventPaid(
              t.matchedCalendarEventId,
              t.id,
              condominiumId,
              userId,
              prisma,
            );
          }
        }
      }

      if (action === 'reopen') {
        for (const t of eligible) {
          if (
            t.matchedCalendarEventId &&
            t.reconciliationStatus === ReconciliationStatus.APPROVED
          ) {
            await this.unmarkTerraceEventPaid(
              t.matchedCalendarEventId,
              t.id,
              condominiumId,
              userId,
              prisma,
            );
          }
        }
      }

      await prisma.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: actionMap[action],
          actionCategory: 'RECONCILIATION',
          module: 'transactions',
          afterState: {
            ids,
            newStatus,
            requested: ids.length,
            affected,
            skipped: ids.length - affected,
          },
          result: 'SUCCESS',
          description: `Bulk ${action}: ${affected} of ${ids.length} transactions`,
        },
      });
    });

    // Recalculate summaries for all affected months (deduped, sequential).
    // Post-commit like the single-row paths: derived data behind its own
    // advisory lock, recomputable if this step fails.
    await this.recomputeMonths(
      condominiumId,
      existing.map((tx) => {
        const d = new Date(tx.transactionDate);
        return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
      }),
    );

    return { affected, skipped: ids.length - affected, requested: ids.length };
  }
}
