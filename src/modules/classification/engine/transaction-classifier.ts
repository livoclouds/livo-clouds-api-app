// Pure per-row classifier (ENGINE-008 decomposition, Phase 6).
// `classifyTransaction` is the engine's pipeline for one transaction:
// extraction → multi-house short-circuit → terrace → editable rules →
// learned corrections → amount gate → fuzzy name. It is a pure function of
// its inputs — all data loading lives in the orchestrating service.

import { MatchSource, ClassificationStatus, RequiresReviewReason, FlowType, BankDialect } from '@prisma/client';
import { matchTerraceBooking, type TerraceCandidate } from '../terrace-booking-matcher';
import {
  applyDbRules,
  deriveResidentIdFromUnit,
  extractFromBanBajio,
  extractFromText,
  matchToResident,
  normalizeText,
  parseMaintenanceConcept,
  resolveNearestCycle,
  resolveRuleUnit,
  type ClassificationResult,
  type CorrectionPatternData,
  type DbRule,
  type RegexCache,
  type ResidentData,
  type TextExtraction,
} from './extraction.util';

export function classifyTransaction(
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
  // ENGINE-012: per-run compile cache for user-rule regexes — one Map per
  // batch/reapply run, threaded down to safeCompile. Optional so single-row
  // callers and existing tests stay unchanged (no cache = compile per call).
  regexCache?: RegexCache,
): ClassificationResult {
  const extraction =
    bankContext?.dialect === BankDialect.BANBAJIO
      ? extractFromBanBajio(description, bankContext.totalUnits)
      : extractFromText(description, bankContext?.totalUnits ?? 0);

  // Default the payment period to the transaction date's month/year when the
  // description does not carry an explicit period. The bank rarely writes
  // "abril 2026" inside SPEI descriptions, so without this fallback the
  // column shows "—" on almost every row.
  if (extraction.paymentPeriodMonth == null || extraction.paymentPeriodYear == null) {
    extraction.paymentPeriodMonth = transactionDate.getUTCMonth() + 1;
    extraction.paymentPeriodYear = transactionDate.getUTCFullYear();
  }

  // EXPENSE branch (ENGINE-013): an outflow is classified by what it bought
  // and who was paid — only EXPENSE rules apply. Whether or not a rule fires,
  // the row NEVER reaches the income passes below (terrace, learned
  // corrections, amount gate, resident matching), so an expense can never
  // receive a residentId or an income concept. The extraction's unit/payer
  // stay as display-only hints; the income-oriented paymentConcept is nulled.
  if (flowType === FlowType.EXPENSE) {
    const expenseRuleMatch = applyDbRules(description, rules, flowType, regexCache);
    if (expenseRuleMatch) {
      const { matchedRule, score } = expenseRuleMatch;
      const isAuto = score >= 0.8;
      return {
        ...extraction,
        paymentConcept: null,
        expenseCategoryId: matchedRule.expenseCategoryId,
        supplierId: matchedRule.supplierId,
        residentId: null,
        matchSource: MatchSource.RULE,
        confidenceScore: score,
        classificationStatus: isAuto
          ? ClassificationStatus.AUTO
          : ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: isAuto ? null : RequiresReviewReason.LOW_CONFIDENCE,
        matchedRuleId: matchedRule.id,
        matchedCalendarEventId: null,
        matchedAt: isAuto ? new Date() : null,
      };
    }
    return {
      ...extraction,
      paymentConcept: null,
      residentId: null,
      matchSource: null,
      confidenceScore: 0,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.NO_MATCH,
      matchedRuleId: null,
      matchedCalendarEventId: null,
      matchedAt: null,
    };
  }

  // Multi-unit payment ("casas 307 y 43"): one credit covering several houses,
  // detected under ANY bank profile (ENGINE-014). We surface ALL detected
  // units (the array) but NEVER auto-classify — a single residentId cannot
  // represent N units, and how the amount splits across them is the operator's
  // call (manual PaymentAllocation rows). Short-circuit BEFORE every matching
  // pass so neither a DB rule nor the amount pass can link a resident. The
  // dedicated reason + the detection confidence make these rows triageable
  // (ENGINE-045); the high score is a DETECTION confidence — this state must
  // never be auto-approved by any future high-confidence automation.
  if (extraction.unitNumbersDetected.length >= 2) {
    return {
      ...extraction,
      unitNumberDetected: null,
      residentId: null,
      matchSource: null,
      confidenceScore: extraction.unitConfidence,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.MULTI_UNIT_SPLIT_REQUIRED,
      matchedRuleId: null,
      matchedCalendarEventId: null,
      matchedAt: null,
    };
  }

  // Terrace booking pass — BEFORE the editable rules (ENGINE-016): a terrace
  // match is corroborated by amount + date against a specific PENDING booking,
  // a strictly higher-information signal than a keyword rule, and the admin
  // catalog has always documented terrace ahead of the rules. A tenant rule
  // containing "terraza" therefore no longer shadows the matcher (which used
  // to leave bookings unpaid forever). Note the matcher sees the RAW extraction
  // unit — a UNIT rule's override no longer feeds it.
  if (
    terraceContext &&
    terraceContext.events.length > 0 &&
    terraceContext.amount !== null &&
    terraceContext.amount > 0
  ) {
    const terraceResult = matchTerraceBooking(
      {
        amount: terraceContext.amount,
        transactionDate: terraceContext.transactionDate,
        description,
        detectedResidentId:
          terraceContext.detectedResidentId
          ?? deriveResidentIdFromUnit(extraction.unitNumberDetected, residents),
        detectedUnitNumber: extraction.unitNumberDetected,
        globalKeywords: terraceContext.globalKeywords,
      },
      terraceContext.events,
    );
    if (terraceResult) {
      return {
        ...extraction,
        paymentConcept: terraceResult.paymentConcept,
        residentId: terraceResult.residentId,
        matchSource: MatchSource[terraceResult.matchSource],
        confidenceScore: terraceResult.confidenceScore,
        classificationStatus: ClassificationStatus[terraceResult.classificationStatus],
        requiresReviewReason: terraceResult.requiresReviewReason
          ? RequiresReviewReason[terraceResult.requiresReviewReason]
          : null,
        matchedRuleId: null,
        matchedCalendarEventId: terraceResult.matchedCalendarEventId,
        matchedAt: terraceResult.matchedAt,
        terraceCandidateEventIds: terraceResult.candidateEventIds,
      };
    }
  }

  // Pass 0: DB-driven rules (priority order, first match wins). Only
  // CONCEPT/UNIT rules can reach this point — EXPENSE flow returned above.
  const ruleMatch = applyDbRules(description, rules, flowType, regexCache);
  if (ruleMatch) {
    const { matchedRule, score } = ruleMatch;

    // UNIT-kind rule: its outcome is a house number. Override the system-detected
    // unit BEFORE resident linkage so the user rule wins over the engine's fixed
    // extractor. The assigned/extracted unit still flows through matchToResident,
    // so a unit absent from the padrón becomes UNIT_NOT_FOUND → NEEDS_REVIEW (never
    // a silent mis-link). The user owns the confidence: the rule's
    // confidenceThreshold is the confidence ASSIGNED to the match (ENGINE-015);
    // the fixed 0.8 AUTO gate in matchToResident decides auto vs review.
    const ruleUnit = resolveRuleUnit(matchedRule, description, regexCache);
    if (ruleUnit) {
      extraction.unitNumberDetected = ruleUnit;
      extraction.unitNumbersDetected = [ruleUnit];
      extraction.unitConfidence = Number(matchedRule.confidenceThreshold);
      // The rule supplied the unit — matchedRuleId attributes it (ENGINE-042).
      extraction.matchedPatternLabel = null;
    }

    const paymentConcept = matchedRule.conceptType ?? extraction.paymentConcept;

    // When the rule fires AND we extracted a unit number, still try to link
    // the resident — a concept rule should not leave a clearly-identified
    // payment unmatched. The resident match drives the review status; the rule
    // keeps ownership of the concept and provenance. A concept-only rule (no
    // unit in the description, e.g. bank-commission rules) keeps the prior
    // auto-classify-without-resident behavior.
    if (extraction.unitNumberDetected) {
      const residentMatch = matchToResident(extraction, residents);
      return {
        ...extraction,
        ...residentMatch,
        paymentConcept,
        matchedRuleId: matchedRule.id,
      };
    }

    // ENGINE-015: `score` IS the rule's confidenceThreshold — the confidence
    // the admin assigned to this rule's matches; 0.8 is the engine-wide gate.
    const isAuto = score >= 0.8;
    return {
      ...extraction,
      paymentConcept,
      residentId: null,
      matchSource: MatchSource.RULE,
      confidenceScore: score,
      classificationStatus: isAuto ? ClassificationStatus.AUTO : ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: isAuto ? null : RequiresReviewReason.LOW_CONFIDENCE,
      matchedRuleId: matchedRule.id,
      matchedCalendarEventId: null,
      matchedAt: isAuto ? new Date() : null,
    };
  }

  // Learned-correction pass (ENGINE-043): when an admin has manually corrected
  // a byte-identical description at least twice, re-apply that correction
  // instead of re-asking every import. Runs AFTER the editable rules (an
  // explicit rule outranks a learned one) and only on INCOME — the correction
  // table stores income-shaped outcomes (unit/resident/concept).
  if (correctionPatterns && correctionPatterns.size > 0) {
    const correction = correctionPatterns.get(normalizeText(description));
    if (correction) {
      const learned = applyCorrectionPattern(correction, extraction, residents);
      if (learned) return learned;
    }
  }

  // Pass 0.6: amount-range maintenance fee. Gated on the credit landing in the
  // configured fee range [ordinaryFee, ordinaryFee + lateFee] — a strong signal
  // that the income is a maintenance payment, which is what makes a flexible
  // month+unit concept parse safe. Resolves advance/late payments via the named
  // month, links the resident when the unit is unambiguous, and otherwise
  // leaves the row in review with the concept + period pre-filled as hints.
  if (
    maintenanceContext &&
    maintenanceContext.amount !== null &&
    maintenanceContext.ordinaryFeeAmount > 0
  ) {
    const min = maintenanceContext.ordinaryFeeAmount;
    const max = maintenanceContext.ordinaryFeeAmount + maintenanceContext.lateFeeAmount;
    if (maintenanceContext.amount >= min && maintenanceContext.amount <= max) {
      const { unit, month } = parseMaintenanceConcept(
        description,
        bankContext?.totalUnits ?? 0,
      );
      if (month !== null) {
        const period = resolveNearestCycle(month, transactionDate);
        extraction.paymentPeriodMonth = period.paymentPeriodMonth;
        extraction.paymentPeriodYear = period.paymentPeriodYear;
      }
      if (unit) {
        extraction.unitNumberDetected = unit;
        extraction.unitNumbersDetected = [unit];
        extraction.unitConfidence = 0.9;
        extraction.matchedPatternLabel = 'banbajio:amount-gate';
      }
      // Pre-fill the concept as a hint even when we cannot link a resident.
      const paymentConcept = extraction.paymentConcept ?? 'MAINTENANCE';

      if (extraction.unitNumberDetected) {
        const residentMatch = matchToResident(extraction, residents);
        return {
          ...extraction,
          ...residentMatch,
          paymentConcept,
          // The amount + date corroborated this link.
          matchSource: residentMatch.residentId
            ? MatchSource.AUTO_AMOUNT_DATE
            : residentMatch.matchSource,
        };
      }

      // Amount in range but no unit to match → leave in review with the
      // concept + period pre-filled as hints for a one-click approval.
      return {
        ...extraction,
        paymentConcept,
        residentId: null,
        matchSource: null,
        confidenceScore: 0,
        classificationStatus: ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: RequiresReviewReason.NO_MATCH,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        matchedAt: null,
      };
    }
  }

  // BanBajío detection fallback: a BanBajío INCOME whose amount did NOT match
  // the fee rule above does NOT auto-classify — only the amount rule (Pass 0.6)
  // moves a payment to Clasificadas. We still surface the unit detected from the
  // concept ("casa NNN") so it shows in the "Unidad detectada" column, and keep
  // the row pending review. matchToResident is consulted only to derive an
  // accurate review reason (UNIT_NOT_FOUND / UNIT_AMBIGUOUS / …).
  if (maintenanceContext) {
    const review = matchToResident(extraction, residents);
    return {
      ...extraction,
      residentId: null,
      matchSource: null,
      confidenceScore: review.confidenceScore,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: review.requiresReviewReason ?? RequiresReviewReason.LOW_CONFIDENCE,
      matchedRuleId: null,
      matchedCalendarEventId: null,
      matchedAt: null,
    };
  }

  const match = matchToResident(extraction, residents);
  return { ...extraction, ...match };
}

/**
 * ENGINE-043: applies a stored manual correction to the current row. Returns
 * null when the correction cannot produce an outcome (e.g. it only named a
 * resident who has since left), letting classifyTransaction fall through to
 * the remaining passes.
 *
 * Trust model: `selectedUnitNumber` is a human-curated value, so it
 * deliberately bypasses the totalUnits range check — but it still funnels
 * through matchToResident, so a unit gone from the padrón degrades to
 * UNIT_NOT_FOUND review, never a silent mis-link. A concept-only correction
 * auto-classifies without a resident, mirroring concept-only rules; if that
 * proves too aggressive, emit NEEDS_REVIEW with the concept as a hint here.
 */
function applyCorrectionPattern(
  correction: CorrectionPatternData,
  extraction: TextExtraction,
  residents: ResidentData[],
): ClassificationResult | null {
  const { selectedUnitNumber, selectedResidentId, selectedConcept } = correction;

  // Strongest form: the admin picked a specific resident. Re-link only while
  // that resident is still active in the padrón.
  if (selectedResidentId) {
    const resident = residents.find((r) => r.id === selectedResidentId);
    if (resident) {
      const unit = selectedUnitNumber ?? resident.unitNumber;
      return {
        ...extraction,
        unitNumberDetected: unit,
        unitNumbersDetected: [unit],
        matchedPatternLabel: null,
        paymentConcept: selectedConcept ?? extraction.paymentConcept,
        residentId: resident.id,
        matchSource: MatchSource.CORRECTION_PATTERN,
        confidenceScore: 0.95,
        classificationStatus: ClassificationStatus.AUTO,
        requiresReviewReason: null,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        matchedAt: new Date(),
      };
    }
    // The corrected resident left — fall through to the unit form (current
    // occupant semantics) or, failing that, the remaining passes.
  }

  if (selectedUnitNumber) {
    extraction.unitNumberDetected = selectedUnitNumber;
    extraction.unitNumbersDetected = [selectedUnitNumber];
    extraction.unitConfidence = 0.95;
    extraction.matchedPatternLabel = null;
    const residentMatch = matchToResident(extraction, residents);
    return {
      ...extraction,
      ...residentMatch,
      paymentConcept: selectedConcept ?? extraction.paymentConcept,
      // Only a successful link is attributed to the correction; a degraded
      // outcome keeps matchToResident's review reason + provenance.
      matchSource: residentMatch.residentId
        ? MatchSource.CORRECTION_PATTERN
        : residentMatch.matchSource,
      confidenceScore: residentMatch.residentId ? 0.95 : residentMatch.confidenceScore,
    };
  }

  if (selectedConcept) {
    return {
      ...extraction,
      paymentConcept: selectedConcept,
      residentId: null,
      matchSource: MatchSource.CORRECTION_PATTERN,
      confidenceScore: 0.95,
      classificationStatus: ClassificationStatus.AUTO,
      requiresReviewReason: null,
      matchedRuleId: null,
      matchedCalendarEventId: null,
      matchedAt: new Date(),
    };
  }

  return null;
}
