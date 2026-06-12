import { Injectable } from '@nestjs/common';
import { BankDialect, FlowType } from '@prisma/client';
import { type TerraceCandidate } from './terrace-booking-matcher';
import { BatchClassificationService } from './batch-classification.service';
import { ManualClassificationService } from './manual-classification.service';
import { SummaryRecomputeService } from '../reconciliation/summary-recompute.service';
import { TerracePaymentLinkService } from '../reconciliation/terrace-payment-link.service';
import { ReconciliationLifecycleService } from '../reconciliation/reconciliation-lifecycle.service';
import {
  buildSystemRulesCatalog,
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
 * Facade over the decomposed classification engine (ENGINE-008, Phase 6).
 *
 * Keeps the full historical public API — imports.service, calendar-reclassify,
 * both controllers and the integration suites all enter through here — while
 * the implementation lives in focused collaborators:
 *   - `engine/` — pure extraction constants/functions + the per-row classifier
 *   - {@link BatchClassificationService} — chunked batch/reapply orchestration
 *   - {@link ManualClassificationService} — manual match/classify/unmatch
 *   - ReconciliationModule — lifecycle (approve/ignore/reopen/bulk), monthly
 *     summaries and terrace payment links
 */
@Injectable()
export class ClassificationService {
  constructor(
    private readonly batch: BatchClassificationService,
    private readonly manual: ManualClassificationService,
    private readonly summaries: SummaryRecomputeService,
    private readonly terraceLinks: TerracePaymentLinkService,
    private readonly lifecycle: ReconciliationLifecycleService,
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

  async classifyBatch(
    condominiumId: string,
    batchId: string,
    actorUserId?: string,
  ): Promise<ClassificationSummary> {
    return this.batch.classifyBatch(condominiumId, batchId, actorUserId);
  }

  async reclassifyBatch(
    condominiumId: string,
    batchId: string,
    userId: string | null,
  ): Promise<ClassificationSummary> {
    return this.batch.reclassifyBatch(condominiumId, batchId, userId);
  }

  /**
   * Reclassify every transaction in the tenant that is awaiting review
   * (`classificationStatus=NEEDS_REVIEW` + `reconciliationStatus=PENDING`)
   * using the current set of active reconciliation rules.
   */
  async reapplyToPending(
    condominiumId: string,
    actorUserId: string | null,
  ): Promise<ClassificationSummary> {
    return this.batch.reapplyToPending(condominiumId, actorUserId);
  }

  async manualMatch(
    condominiumId: string,
    transactionId: string,
    residentId: string,
    userId: string,
  ): Promise<void> {
    await this.manual.manualMatch(condominiumId, transactionId, residentId, userId);
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
    await this.manual.manualClassify(condominiumId, transactionId, dto, userId);
  }

  async unmatch(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    await this.manual.unmatch(condominiumId, transactionId, userId);
  }

  // ENGINE-002 — public recompute for callers that delete transactions and
  // must rebuild the official monthly numbers afterwards (imports remove()).
  async recomputeSummariesForMonths(
    condominiumId: string,
    months: Array<{ year: number; month: number }>,
  ): Promise<void> {
    await this.summaries.recomputeSummariesForMonths(condominiumId, months);
  }

  // ENGINE-002 — revert terrace bookings marked PAID by transactions of the
  // given batch. Called by imports remove() before hard-deleting the rows.
  async revertTerraceLinksForBatch(
    condominiumId: string,
    batchId: string,
    userId: string,
  ): Promise<void> {
    await this.terraceLinks.revertTerraceLinksForBatch(condominiumId, batchId, userId);
  }

  async approveTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    await this.lifecycle.approveTransaction(condominiumId, transactionId, userId);
  }

  async ignoreTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    await this.lifecycle.ignoreTransaction(condominiumId, transactionId, userId);
  }

  async reopenTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    await this.lifecycle.reopenTransaction(condominiumId, transactionId, userId);
  }

  async bulkReconcile(
    condominiumId: string,
    ids: string[],
    action: 'approve' | 'ignore' | 'reopen',
    userId: string,
  ): Promise<{ affected: number; skipped: number; requested: number }> {
    return this.lifecycle.bulkReconcile(condominiumId, ids, action, userId);
  }
}
