import { BadRequestException, ConflictException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MatchSource, ClassificationStatus, RequiresReviewReason, ReconciliationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReconciliationRulesService } from '../reconciliation-rules/reconciliation-rules.service';
import {
  CLASSIFICATION_REVIEW_NEEDED_EVENT,
  type ClassificationReviewNeededEventPayload,
} from './events/classification-notification-events';
import { matchTerraceBooking, type TerraceCandidate } from './terrace-booking-matcher';
import { validateTerraceMetadata } from '../calendar/terrace-metadata.validator';
import { SettingsCacheService } from '../settings/settings-cache.service';
import { isBanBajio } from '../bank-profiles/known-banks';

/**
 * Phase 6 (A4): page size for cursor-batched loading of classification
 * candidate sets (residents, terrace bookings). The matcher needs the complete
 * set in memory, so this bounds the per-query result/driver buffer — not the
 * working set. A small condominium returns a single page (< pageSize) and stops
 * after one round, so behavior is unchanged for the common case.
 */
const CANDIDATE_PAGE_SIZE = 500;

interface ResidentData {
  id: string;
  unitNumber: string;
  firstName: string;
  lastName: string;
}

interface DbRule {
  id: string;
  keywords: string[];
  unitPatterns: string[];
  conceptType: string | null;
  confidenceThreshold: Prisma.Decimal;
}

interface TextExtraction {
  unitNumberDetected: string | null;
  unitConfidence: number;
  payerNameDetected: string | null;
  paymentConcept: string | null;
  paymentPeriodYear: number | null;
  paymentPeriodMonth: number | null;
}

interface MatchResult {
  residentId: string | null;
  matchSource: MatchSource | null;
  confidenceScore: number;
  classificationStatus: ClassificationStatus;
  requiresReviewReason: RequiresReviewReason | null;
  matchedRuleId: string | null;
  matchedCalendarEventId: string | null;
  matchedAt: Date | null;
}

export interface ClassificationResult extends TextExtraction, MatchResult {}

export interface ClassificationSummary {
  total: number;
  classified: number;
  needsReview: number;
  unmatched: number;
}

const UNIT_PATTERNS: { regex: RegExp; confidence: number }[] = [
  { regex: /\bcasa\s+(\d{1,4}[a-z]?)\b/i, confidence: 0.95 },
  { regex: /\bunidad\s+(\d{1,4}[a-z]?)\b/i, confidence: 0.95 },
  { regex: /\blote\s+(\d{1,4}[a-z]?)\b/i, confidence: 0.9 },
  { regex: /\bc\.?\s*(\d{1,4}[a-z]?)\b/i, confidence: 0.85 },
  { regex: /\bdepto?\.?\s*(\d{1,4}[a-z]?)\b/i, confidence: 0.85 },
  { regex: /#\s*(\d{1,4}[a-z]?)\b/i, confidence: 0.8 },
];

const CONCEPT_PATTERNS: { regex: RegExp; concept: string }[] = [
  { regex: /mantenimiento|cuota\s+mensual|mensualidad|mant\b/i, concept: 'MAINTENANCE' },
  { regex: /deposito|dep[oó]sito|garant[ií]a/i, concept: 'DEPOSIT' },
  { regex: /multa|sanci[oó]n|infracci[oó]n/i, concept: 'FINE' },
  { regex: /\bagua\b|\bluz\b|electricidad|internet|\bgas\b/i, concept: 'UTILITY' },
  { regex: /estacionamiento|parking|caj[oó]n/i, concept: 'PARKING' },
  { regex: /terraza|alberca|sal[oó]n|amenidad/i, concept: 'AMENITY' },
];

const MONTH_MAP: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may_: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

const PAYER_PATTERNS: RegExp[] = [
  /nombre:\s*([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+ref|\s+\d|$)/i,
  /de:\s*([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+ref|\s+\d|$)/i,
  /pago\s+de\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+casa|\s+unidad|\s+c\d|\s+\d|$)/i,
];

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinSimilarity(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 && n === 0) return 1;
  if (m === 0 || n === 0) return 0;

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

export function extractFromText(description: string): TextExtraction {
  const normalized = normalizeText(description);

  let unitNumberDetected: string | null = null;
  let unitConfidence = 0;
  for (const { regex, confidence } of UNIT_PATTERNS) {
    const match = normalized.match(regex);
    if (match) {
      unitNumberDetected = match[1].toUpperCase();
      unitConfidence = confidence;
      break;
    }
  }

  let paymentConcept: string | null = null;
  for (const { regex, concept } of CONCEPT_PATTERNS) {
    if (regex.test(normalized)) {
      paymentConcept = concept;
      break;
    }
  }

  let paymentPeriodMonth: number | null = null;
  let paymentPeriodYear: number | null = null;
  const monthNames = Object.keys(MONTH_MAP)
    .map((k) => (k === 'may_' ? 'may' : k))
    .sort((a, b) => b.length - a.length);
  const namedPeriod = normalized.match(
    new RegExp(`\\b(${monthNames.join('|')})\\b[\\s/\\-]+(20\\d{2})\\b`),
  );
  if (namedPeriod) {
    const monthKey = namedPeriod[1] === 'may' ? 'may_' : namedPeriod[1];
    paymentPeriodMonth = MONTH_MAP[monthKey] ?? MONTH_MAP[namedPeriod[1]] ?? null;
    paymentPeriodYear = parseInt(namedPeriod[2], 10);
  } else {
    const numericPeriod = normalized.match(/\b(0?[1-9]|1[0-2])[/\-](20\d{2})\b/);
    if (numericPeriod) {
      paymentPeriodMonth = parseInt(numericPeriod[1], 10);
      paymentPeriodYear = parseInt(numericPeriod[2], 10);
    }
  }

  let payerNameDetected: string | null = null;
  for (const pattern of PAYER_PATTERNS) {
    const match = description.match(pattern);
    if (match) {
      payerNameDetected = match[1].trim();
      break;
    }
  }

  return {
    unitNumberDetected,
    unitConfidence,
    payerNameDetected,
    paymentConcept,
    paymentPeriodYear,
    paymentPeriodMonth,
  };
}

/**
 * BanBajío-specific unit extraction. Their SPEI descriptions carry the unit in a
 * "Concepto del Pago: <unit> <month> | Recibo # <n>" segment (e.g.
 * "...Concepto del Pago: 106 noviembre | Recibo # 227120243..."). We read the
 * leading number of that segment and accept it only when it falls within the
 * condominium's configured unit range (1..totalUnits) — so account numbers, RFC
 * and reference digits elsewhere in the description never get mistaken for a
 * unit. Everything else (concept, payer, period) reuses the generic extractor.
 */
export function extractFromBanBajio(
  description: string,
  totalUnits: number,
): TextExtraction {
  const base = extractFromText(description);

  // For BanBajío the unit ONLY comes from the "Concepto del Pago: <unit> ... |"
  // segment. We deliberately ignore the generic extractor's unit guess here —
  // its "#"-prefixed pattern would otherwise grab "Recibo # <n>" and other digit
  // groups. Concept, payer and period still reuse the generic extractor.
  let unitNumberDetected: string | null = null;
  let unitConfidence = 0;

  const segment = description.match(/concepto del pago:\s*([^|]*)/i);
  if (segment) {
    // Leading number of the segment, tolerating leading zeros ("06" -> 6).
    const leading = segment[1].match(/^\s*0*(\d+)/);
    if (leading) {
      const unit = parseInt(leading[1], 10);
      if (Number.isFinite(unit) && unit >= 1 && totalUnits > 0 && unit <= totalUnits) {
        unitNumberDetected = String(unit);
        unitConfidence = 0.95;
      }
    }
  }

  return { ...base, unitNumberDetected, unitConfidence };
}

/**
 * Parses the BanBajío "Concepto del Pago:" segment for the maintenance-fee pass,
 * extracting the unit number and the named month in ANY order. Handles formats
 * the leading-number extractor misses: "DIC 355", "Enero casa 120",
 * "Mantenimiento febrero 88", "355 noviembre". A bare number is only accepted
 * when it is unambiguous and within 1..totalUnits — and the caller only invokes
 * this when the amount already falls in the expected fee range, which is what
 * makes grabbing a bare number safe.
 */
export function parseMaintenanceConcept(
  description: string,
  totalUnits: number,
): { unit: string | null; month: number | null } {
  const segMatch = description.match(/concepto del pago:\s*([^|]*)/i);
  if (!segMatch) return { unit: null, month: null };
  const segment = normalizeText(segMatch[1]);

  // Month: any MONTH_MAP key as a whole word, longest-first so "may" never
  // matches inside a longer token.
  let month: number | null = null;
  const monthNames = Object.keys(MONTH_MAP)
    .map((k) => (k === 'may_' ? 'may' : k))
    .sort((a, b) => b.length - a.length);
  const monthMatch = segment.match(new RegExp(`\\b(${monthNames.join('|')})\\b`));
  if (monthMatch) {
    const key = monthMatch[1] === 'may' ? 'may_' : monthMatch[1];
    month = MONTH_MAP[key] ?? MONTH_MAP[monthMatch[1]] ?? null;
  }

  // Unit: prefer a prefixed match (casa/unidad/lote/depto/c). The "#" pattern is
  // harmless here because "| Recibo #" lives outside this segment.
  let unit: string | null = null;
  for (const { regex } of UNIT_PATTERNS) {
    const m = segment.match(regex);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 1 && totalUnits > 0 && n <= totalUnits) {
        unit = String(n);
      }
      break;
    }
  }
  // Otherwise the lone in-range number, skipping 4-digit years.
  if (!unit) {
    const inRange = new Set<number>();
    const numRe = /\b0*(\d+)\b/g;
    let mm: RegExpExecArray | null;
    while ((mm = numRe.exec(segment)) !== null) {
      const raw = mm[1];
      if (/^20\d{2}$/.test(raw)) continue;
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 1 && totalUnits > 0 && n <= totalUnits) {
        inRange.add(n);
      }
    }
    if (inRange.size === 1) unit = String([...inRange][0]);
  }

  return { unit, month };
}

/**
 * Resolves the payment period for a named month that carries no explicit year.
 * Residents pay in advance ("DIC" in November → December) or late ("OCT" in
 * November → October), so we pick the year (tx year ±1) that places the period
 * in the cycle closest to the transaction date.
 */
export function resolveNearestCycle(
  month: number,
  transactionDate: Date,
): { paymentPeriodMonth: number; paymentPeriodYear: number } {
  const txYear = transactionDate.getUTCFullYear();
  const txIndex = txYear * 12 + (transactionDate.getUTCMonth() + 1);
  let bestYear = txYear;
  let bestDist = Infinity;
  for (const y of [txYear - 1, txYear, txYear + 1]) {
    const dist = Math.abs(y * 12 + month - txIndex);
    if (dist < bestDist) {
      bestDist = dist;
      bestYear = y;
    }
  }
  return { paymentPeriodMonth: month, paymentPeriodYear: bestYear };
}

function applyDbRules(
  description: string,
  rules: DbRule[],
): { matchedRule: DbRule; score: number } | null {
  const normalized = normalizeText(description);

  for (const rule of rules) {
    const allKeywordsMatch = rule.keywords.length > 0 &&
      rule.keywords.every((kw) => normalized.includes(normalizeText(kw)));

    const patternMatch = rule.unitPatterns.length > 0 &&
      rule.unitPatterns.some((p) => {
        try {
          return new RegExp(p, 'i').test(normalized);
        } catch {
          return false;
        }
      });

    if (allKeywordsMatch || (rule.unitPatterns.length > 0 && patternMatch)) {
      return { matchedRule: rule, score: Number(rule.confidenceThreshold) };
    }
  }

  return null;
}

function deriveResidentIdFromUnit(
  unitNumberDetected: string | null,
  residents: ResidentData[],
): string | null {
  if (!unitNumberDetected) return null;
  const target = normalizeText(unitNumberDetected);
  const matches = residents.filter((r) => normalizeText(r.unitNumber) === target);
  return matches.length === 1 ? matches[0].id : null;
}

function matchToResident(
  extraction: TextExtraction,
  residents: ResidentData[],
): MatchResult {
  // Pass 1: exact unit number match
  if (extraction.unitNumberDetected) {
    const normalizedDetected = normalizeText(extraction.unitNumberDetected);
    const matches = residents.filter(
      (r) => normalizeText(r.unitNumber) === normalizedDetected,
    );

    if (matches.length === 1) {
      const found = matches[0];
      const score = extraction.unitConfidence;
      const isAuto = score >= 0.8;
      return {
        residentId: isAuto ? found.id : null,
        matchSource: MatchSource.AUTO_UNIT_NUMBER,
        confidenceScore: score,
        classificationStatus: isAuto ? ClassificationStatus.AUTO : ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: isAuto ? null : RequiresReviewReason.LOW_CONFIDENCE,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        matchedAt: isAuto ? new Date() : null,
      };
    }

    if (matches.length > 1) {
      return {
        residentId: null,
        matchSource: MatchSource.AUTO_UNIT_NUMBER,
        confidenceScore: extraction.unitConfidence,
        classificationStatus: ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: RequiresReviewReason.UNIT_AMBIGUOUS,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        matchedAt: null,
      };
    }

    return {
      residentId: null,
      matchSource: null,
      confidenceScore: 0,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.UNIT_NOT_FOUND,
      matchedRuleId: null,
      matchedCalendarEventId: null,
      matchedAt: null,
    };
  }

  // Pass 2: fuzzy name match
  if (extraction.payerNameDetected) {
    const normalizedPayer = normalizeText(extraction.payerNameDetected);
    let bestScore = 0;
    let bestResident: ResidentData | null = null;
    let matchCount = 0;

    for (const r of residents) {
      const fullName = normalizeText(`${r.firstName} ${r.lastName}`);
      const score = levenshteinSimilarity(normalizedPayer, fullName);
      if (score >= 0.75) {
        matchCount++;
        if (score > bestScore) {
          bestScore = score;
          bestResident = r;
        }
      }
    }

    if (bestResident) {
      const multipleMatches = matchCount > 1;
      const isAuto = !multipleMatches && bestScore >= 0.8;
      return {
        residentId: isAuto ? bestResident.id : null,
        matchSource: MatchSource.AUTO_NAME,
        confidenceScore: bestScore,
        classificationStatus: isAuto ? ClassificationStatus.AUTO : ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: isAuto ? null : (multipleMatches ? RequiresReviewReason.NAME_AMBIGUOUS : RequiresReviewReason.LOW_CONFIDENCE),
        matchedRuleId: null,
        matchedCalendarEventId: null,
        matchedAt: isAuto ? new Date() : null,
      };
    }

    return {
      residentId: null,
      matchSource: null,
      confidenceScore: 0,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.NAME_NOT_FOUND,
      matchedRuleId: null,
      matchedCalendarEventId: null,
      matchedAt: null,
    };
  }

  // Pass 3: no match
  return {
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
    // Bank identity + unit bound for bank-specific extraction. `bankName` comes
    // from the batch's bank profile; `totalUnits` from CondominiumSettings.
    bankContext?: { bankName: string | null; totalUnits: number },
    // Maintenance-fee pass inputs. Provided only for INCOME transactions on a
    // BanBajío batch; `amount` is the credit, the fees come from CondominiumSettings.
    maintenanceContext?: {
      amount: number | null;
      ordinaryFeeAmount: number;
      lateFeeAmount: number;
    },
  ): ClassificationResult {
    const extraction =
      bankContext && isBanBajio(bankContext.bankName)
        ? extractFromBanBajio(description, bankContext.totalUnits)
        : extractFromText(description);

    // Default the payment period to the transaction date's month/year when the
    // description does not carry an explicit period. The bank rarely writes
    // "abril 2026" inside SPEI descriptions, so without this fallback the
    // column shows "—" on almost every row.
    if (extraction.paymentPeriodMonth == null || extraction.paymentPeriodYear == null) {
      extraction.paymentPeriodMonth = transactionDate.getUTCMonth() + 1;
      extraction.paymentPeriodYear = transactionDate.getUTCFullYear();
    }

    // Pass 0: DB-driven rules (priority order, first match wins)
    const ruleMatch = applyDbRules(description, rules);
    if (ruleMatch) {
      const { matchedRule, score } = ruleMatch;
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

    // Pass 0.5: terrace booking matching — only for INCOME transactions with amount data.
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
        };
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
          extraction.unitConfidence = 0.9;
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

    const match = matchToResident(extraction, residents);
    return { ...extraction, ...match };
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
    ] = await Promise.all([
      this.loadCandidates(condominiumId),
      this.prisma.transaction.findMany({
        where: { condominiumId, importBatchId: batchId },
        select: { id: true, description: true, transactionDate: true, credits: true, charges: true, flowType: true },
      }),
      this.prisma.importBatch.findUnique({
        where: { id: batchId },
        select: { bankProfile: { select: { bankName: true } } },
      }),
    ]);

    // The whole batch shares one bank profile, so the bank identity is read once.
    const bankName = batchInfo?.bankProfile?.bankName ?? null;

    let classified = 0;
    let needsReview = 0;
    let unmatched = 0;

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

        // Maintenance-fee pass runs only for BanBajío INCOME (the concept format
        // is bank-specific). Fees come from the condominium settings.
        const maintenanceContext =
          tx.flowType === 'INCOME' && isBanBajio(bankName)
            ? { amount: tx.credits ? Number(tx.credits) : null, ordinaryFeeAmount, lateFeeAmount }
            : undefined;

        const result = this.classifyTransaction(
          tx.description,
          new Date(tx.transactionDate),
          residents,
          activeRules,
          terraceContext,
          { bankName, totalUnits },
          maintenanceContext,
        );

        const data: Prisma.TransactionUncheckedUpdateManyInput = {
          unitNumberDetected: result.unitNumberDetected,
          payerNameDetected: result.payerNameDetected,
          paymentConcept: result.paymentConcept,
          paymentPeriodYear: result.paymentPeriodYear,
          paymentPeriodMonth: result.paymentPeriodMonth,
          matchSource: result.matchSource,
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

        if (result.classificationStatus === ClassificationStatus.AUTO) {
          classified++;
        } else {
          needsReview++;
          if (!result.residentId) unmatched++;
        }
      }

      const updates = Array.from(groups.values()).map(({ ids, data }) =>
        this.prisma.transaction.updateMany({
          where: { condominiumId, id: { in: ids } },
          data,
        }),
      );
      await this.prisma.$transaction(updates);

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

    return { total: transactions.length, classified, needsReview, unmatched };
  }

  async reclassifyBatch(
    condominiumId: string,
    batchId: string,
    userId: string | null,
  ): Promise<ClassificationSummary> {
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

    await this.prisma.transaction.updateMany({
      where: { condominiumId, importBatchId: batchId },
      data: {
        classificationStatus: ClassificationStatus.NEEDS_REVIEW,
        residentId: null,
        matchSource: null,
        confidenceScore: null,
        matchedAt: null,
        requiresReviewReason: null,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        classificationVersion: { increment: 1 },
      },
    });
    const summary = await this.classifyBatch(condominiumId, batchId);

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
          },
          result: 'SUCCESS',
          description: `Batch reclassified: ${summary.total} transactions processed`,
        },
      });
    }

    return summary;
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
            // Pending rows span multiple batches/banks, so the bank identity is
            // read per transaction (not once like classifyBatch).
            importBatch: { select: { bankProfile: { select: { bankName: true } } } },
          },
        }),
      ]);

    let classified = 0;
    let needsReview = 0;
    let unmatched = 0;

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

        const txBankName = tx.importBatch?.bankProfile?.bankName ?? null;
        const maintenanceContext =
          tx.flowType === 'INCOME' && isBanBajio(txBankName)
            ? { amount: tx.credits ? Number(tx.credits) : null, ordinaryFeeAmount, lateFeeAmount }
            : undefined;

        const result = this.classifyTransaction(
          tx.description,
          new Date(tx.transactionDate),
          residents,
          activeRules,
          terraceContext,
          { bankName: txBankName, totalUnits },
          maintenanceContext,
        );

        const data: Prisma.TransactionUncheckedUpdateManyInput = {
          unitNumberDetected: result.unitNumberDetected,
          payerNameDetected: result.payerNameDetected,
          paymentConcept: result.paymentConcept,
          paymentPeriodYear: result.paymentPeriodYear,
          paymentPeriodMonth: result.paymentPeriodMonth,
          matchSource: result.matchSource,
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

        if (result.classificationStatus === ClassificationStatus.AUTO) {
          classified++;
        } else {
          needsReview++;
          if (!result.residentId) unmatched++;
        }

        const d = new Date(tx.transactionDate);
        affectedMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
      }

      const updates = Array.from(groups.values()).map(({ ids, data }) =>
        this.prisma.transaction.updateMany({
          where: { condominiumId, id: { in: ids } },
          data,
        }),
      );
      await this.prisma.$transaction(updates);
    }

    // Recompute monthly summaries for every period that had at least one
    // touched transaction. classifyBatch does this scoped by batchId; here
    // we span batches but the per-month aggregation is the same.
    await Promise.all(
      Array.from(affectedMonths).map((key) => {
        const [year, month] = key.split('-').map(Number);
        return this.upsertSummaryForMonth(condominiumId, year, month);
      }),
    );

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
          },
          result: 'SUCCESS',
          description: `Reapplied rules to ${transactions.length} pending transactions: ${classified} classified, ${needsReview} still need review`,
        },
      });
    }

    return { total: transactions.length, classified, needsReview, unmatched };
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
      throw new Error('Resident not found in this condominium');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          residentId: true,
          matchSource: true,
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
      paymentConcept?: string;
      paymentPeriodMonth?: number;
      paymentPeriodYear?: number;
      transactionDate?: string;
      description?: string;
    },
    userId: string,
  ): Promise<void> {
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

    await this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          description: true,
          residentId: true,
          unitNumberDetected: true,
          paymentConcept: true,
          paymentPeriodMonth: true,
          paymentPeriodYear: true,
          transactionDate: true,
          matchSource: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
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
          ...(dto.unitNumber !== undefined && { unitNumberDetected: dto.unitNumber || null }),
          ...(dto.paymentConcept !== undefined && { paymentConcept: dto.paymentConcept || null }),
          ...(dto.paymentPeriodMonth !== undefined && { paymentPeriodMonth: dto.paymentPeriodMonth }),
          ...(dto.paymentPeriodYear !== undefined && { paymentPeriodYear: dto.paymentPeriodYear }),
          ...(dto.transactionDate !== undefined && { transactionDate: new Date(dto.transactionDate) }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(residentId !== undefined && { residentId }),
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

      const descriptionForPattern = dto.description ?? existingTx.description;
      if (descriptionForPattern) {
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
            paymentPeriodMonth: existingTx.paymentPeriodMonth,
            paymentPeriodYear: existingTx.paymentPeriodYear,
            transactionDate: existingTx.transactionDate,
            matchSource: existingTx.matchSource,
            classificationStatus: existingTx.classificationStatus,
            requiresReviewReason: existingTx.requiresReviewReason,
            matchedRuleId: existingTx.matchedRuleId,
          },
          afterState: {
            residentId: residentId !== undefined ? residentId : (existingTx.residentId ?? null),
            unitNumberDetected: dto.unitNumber !== undefined ? (dto.unitNumber || null) : existingTx.unitNumberDetected,
            paymentConcept: dto.paymentConcept !== undefined ? (dto.paymentConcept || null) : existingTx.paymentConcept,
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

    await Promise.all(
      Array.from(uniqueMonths).map((key) => {
        const [year, month] = key.split('-').map(Number);
        return this.upsertSummaryForMonth(condominiumId, year, month);
      }),
    );
  }

  private async upsertSummaryForMonth(
    condominiumId: string,
    year: number,
    month: number,
  ): Promise<void> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    // Only APPROVED transactions affect official income/expense totals
    const [incomeAgg, expenseAgg, classificationCounts, reconciliationCounts] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          condominiumId,
          flowType: 'INCOME',
          transactionDate: { gte: start, lt: end },
          reconciliationStatus: ReconciliationStatus.APPROVED,
        },
        _sum: { credits: true },
        _count: true,
      }),
      this.prisma.transaction.aggregate({
        where: {
          condominiumId,
          flowType: 'EXPENSE',
          transactionDate: { gte: start, lt: end },
          reconciliationStatus: ReconciliationStatus.APPROVED,
        },
        _sum: { charges: true },
        _count: true,
      }),
      this.prisma.transaction.groupBy({
        by: ['classificationStatus'],
        where: { condominiumId, transactionDate: { gte: start, lt: end } },
        _count: true,
      }),
      this.prisma.transaction.groupBy({
        by: ['reconciliationStatus'],
        where: { condominiumId, transactionDate: { gte: start, lt: end } },
        _count: true,
      }),
    ]);

    const totalIncome = Number(incomeAgg._sum.credits ?? 0);
    const totalExpenses = Number(expenseAgg._sum.charges ?? 0);
    const approvedCount = incomeAgg._count + expenseAgg._count;

    const totalAll = await this.prisma.transaction.count({
      where: { condominiumId, transactionDate: { gte: start, lt: end } },
    });

    const classifiedCount =
      classificationCounts.find((s) => s.classificationStatus === 'AUTO')?._count ?? 0;
    const needsReviewCount =
      classificationCounts.find((s) => s.classificationStatus === 'NEEDS_REVIEW')?._count ?? 0;

    const pendingCount =
      reconciliationCounts.find((s) => s.reconciliationStatus === 'PENDING')?._count ?? 0;
    const ignoredCount =
      reconciliationCounts.find((s) => s.reconciliationStatus === 'IGNORED')?._count ?? 0;

    const unmatchedRows = await this.prisma.transaction.count({
      where: {
        condominiumId,
        transactionDate: { gte: start, lt: end },
        classificationStatus: 'NEEDS_REVIEW',
        residentId: null,
      },
    });

    await this.prisma.financialMonthlySummary.upsert({
      where: { condominiumId_year_month: { condominiumId, year, month } },
      create: {
        condominiumId,
        year,
        month,
        totalIncome: new Prisma.Decimal(totalIncome.toFixed(2)),
        totalExpenses: new Prisma.Decimal(totalExpenses.toFixed(2)),
        netBalance: new Prisma.Decimal((totalIncome - totalExpenses).toFixed(2)),
        transactionCount: totalAll,
        classifiedCount,
        needsReviewCount,
        unmatchedCount: unmatchedRows,
        approvedCount,
        pendingCount,
        ignoredCount,
      },
      update: {
        totalIncome: new Prisma.Decimal(totalIncome.toFixed(2)),
        totalExpenses: new Prisma.Decimal(totalExpenses.toFixed(2)),
        netBalance: new Prisma.Decimal((totalIncome - totalExpenses).toFixed(2)),
        transactionCount: totalAll,
        classifiedCount,
        needsReviewCount,
        unmatchedCount: unmatchedRows,
        approvedCount,
        pendingCount,
        ignoredCount,
      },
    });
  }

  async approveTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId },
      select: {
        transactionDate: true,
        reconciliationStatus: true,
        matchedCalendarEventId: true,
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const before = { reconciliationStatus: tx.reconciliationStatus };
    const now = new Date();

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: ReconciliationStatus.APPROVED,
        reconciledById: userId,
        reconciledAt: now,
      },
    });

    const d = new Date(tx.transactionDate);
    await this.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);

    // When a terrace booking was linked, mark it as PAID on approval.
    if (tx.matchedCalendarEventId) {
      await this.markTerraceEventPaid(tx.matchedCalendarEventId, transactionId, condominiumId, userId);
    }

    await this.prisma.auditLog.create({
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
  }

  private async markTerraceEventPaid(
    calendarEventId: string,
    transactionId: string,
    condominiumId: string,
    userId: string,
  ): Promise<void> {
    const ev = await this.prisma.calendarEvent.findFirst({
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

    await this.prisma.calendarEvent.update({
      where: { id: calendarEventId },
      data: { metadata: updatedMetadata as unknown as Prisma.InputJsonValue },
    });

    await this.prisma.auditLog.create({
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
  ): Promise<void> {
    const ev = await this.prisma.calendarEvent.findFirst({
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

    await this.prisma.calendarEvent.update({
      where: { id: calendarEventId },
      data: { metadata: updatedMetadata as unknown as Prisma.InputJsonValue },
    });

    await this.prisma.auditLog.create({
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

  async ignoreTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const before = { reconciliationStatus: tx.reconciliationStatus };
    const now = new Date();

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: ReconciliationStatus.IGNORED,
        reconciledById: userId,
        reconciledAt: now,
      },
    });

    const d = new Date(tx.transactionDate);
    await this.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);

    await this.prisma.auditLog.create({
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

    const uniqueMonths = new Set<string>();
    const d = new Date(capturedDate!);
    uniqueMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
    await Promise.all(
      Array.from(uniqueMonths).map((key) => {
        const [year, month] = key.split('-').map(Number);
        return this.upsertSummaryForMonth(condominiumId, year, month);
      }),
    );

    if (capturedCalendarEventId) {
      await this.unmarkTerraceEventPaid(capturedCalendarEventId, transactionId, condominiumId, userId);
    }
  }

  async bulkReconcile(
    condominiumId: string,
    ids: string[],
    action: 'approve' | 'ignore' | 'reopen',
    userId: string,
  ): Promise<{ affected: number }> {
    // Verify all IDs belong to this condominium (IDOR protection)
    const existing = await this.prisma.transaction.findMany({
      where: { id: { in: ids }, condominiumId },
      select: { id: true, transactionDate: true, reconciliationStatus: true, matchedCalendarEventId: true },
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

    await this.prisma.$transaction([
      this.prisma.transaction.updateMany({
        where: { id: { in: ids }, condominiumId },
        data: {
          reconciliationStatus: newStatus,
          reconciledById: action === 'reopen' ? null : userId,
          reconciledAt: action === 'reopen' ? null : now,
        },
      }),
    ]);

    // Recalculate summaries for all affected months
    const uniqueMonths = new Set<string>();
    for (const tx of existing) {
      const d = new Date(tx.transactionDate);
      uniqueMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
    }
    await Promise.all(
      Array.from(uniqueMonths).map((key) => {
        const [year, month] = key.split('-').map(Number);
        return this.upsertSummaryForMonth(condominiumId, year, month);
      }),
    );

    if (action === 'reopen') {
      const toRevert = existing.filter(
        (t) => t.matchedCalendarEventId && t.reconciliationStatus === ReconciliationStatus.APPROVED,
      );
      await Promise.all(
        toRevert.map((t) =>
          this.unmarkTerraceEventPaid(t.matchedCalendarEventId!, t.id, condominiumId, userId),
        ),
      );
    }

    const actionMap: Record<string, string> = {
      approve: 'TRANSACTIONS_BULK_APPROVED',
      ignore: 'TRANSACTIONS_BULK_IGNORED',
      reopen: 'TRANSACTIONS_BULK_REOPENED',
    };

    await this.prisma.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: actionMap[action],
        actionCategory: 'RECONCILIATION',
        module: 'transactions',
        afterState: { ids, newStatus, count: ids.length },
        result: 'SUCCESS',
        description: `Bulk ${action}: ${ids.length} transactions`,
      },
    });

    return { affected: ids.length };
  }
}
