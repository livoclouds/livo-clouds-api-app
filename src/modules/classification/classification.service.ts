import { BadRequestException, ConflictException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
// `re2` is a CommonJS module that uses `export = RE2`; with esModuleInterop off,
// import-equals is the form that resolves to the constructor at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import RE2 = require('re2');
import { MatchSource, ClassificationStatus, RequiresReviewReason, ReconciliationStatus, ReconciliationRuleKind, FlowType, Prisma } from '@prisma/client';
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
import { STALE_PROCESSING_MS } from '../imports/imports.constants';

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

export interface DbRule {
  id: string;
  ruleKind: ReconciliationRuleKind;
  keywords: string[];
  unitPatterns: string[];
  conceptType: string | null;
  // UNIT-rule outcome (null on CONCEPT rules). Either a fixed unit number
  // (assignedUnitNumber) or a capture-group regex + group index that extracts
  // the unit from the description.
  assignedUnitNumber: string | null;
  unitExtractionPattern: string | null;
  unitExtractionGroup: number | null;
  // EXPENSE-rule outcome (null on CONCEPT/UNIT rules): the category and/or
  // supplier to stamp on a matched EXPENSE transaction.
  expenseCategoryId: string | null;
  supplierId: string | null;
  confidenceThreshold: Prisma.Decimal;
}

interface TextExtraction {
  unitNumberDetected: string | null;
  // All units named when a single payment covers MORE than one house
  // ("casas 307 y 43"). Single-unit detection populates this with one element;
  // the scalar `unitNumberDetected` stays as the 1:1 primary (null for multi).
  unitNumbersDetected: string[];
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

export interface ClassificationResult extends TextExtraction, MatchResult {
  // EXPENSE-side outcome. Optional so the income-oriented return paths (which
  // spread only TextExtraction + MatchResult) stay valid; defaults to null at
  // persistence. Set only when an EXPENSE rule fires on an EXPENSE transaction.
  expenseCategoryId?: string | null;
  supplierId?: string | null;
}

export interface ClassificationSummary {
  total: number;
  classified: number;
  needsReview: number;
  unmatched: number;
}

/**
 * Read-only, condominium-agnostic description of the engine's *hardcoded* logic —
 * the part that does NOT live in the editable `ReconciliationRule` table (Pass 0).
 * Surfaced via GET …/reconciliation-rules/system so the UI can render the engine's
 * built-in rules read-only ("reglas del sistema") next to the editable ones, ending
 * the black-box gap. Everything here is derived from the engine's own constants, so
 * editing a pattern automatically updates this catalog.
 */
export interface SystemRulesCatalog {
  /** Concept keyword detection (CONCEPT_PATTERNS): which terms tag which concept. */
  conceptPatterns: { concept: string; terms: string[] }[];
  /** Unit-number prefixes the engine recognizes (UNIT_PATTERNS). */
  unitPatterns: { label: string; example: string; confidence: number }[];
  /** Month names/abbreviations recognized for the payment period (MONTH_MAP). */
  months: { month: number; forms: string[] }[];
  /** Hardcoded non-keyword passes; title/description localized in the web by `key`. */
  behavioralPasses: { key: string; order: number }[];
}

// The unit keyword may run straight into the number with no space ("casa34",
// "CASA233Noviembre2025") or into trailing text ("casa77manttonoviembre2025").
// So the separator is `\s*` (optional) and we capture up to 4 digits that are NOT
// followed by another digit — `0*(\d{1,4})(?!\d)`. The `(?!\d)` replaces the old
// trailing `\b` (a digit→letter transition is not a word boundary, so `\b`
// mis-anchored glued forms): it still stops at the first letter ("casa77mantto"
// -> 77, "CASA233Noviembre" -> 233) but refuses a 4-digit PREFIX of a longer run
// ("Recibo # 227120243" never yields "2271").
// `label` + `example` are human-readable documentation of each pattern, surfaced
// read-only by getSystemRulesCatalog() so admins can see how the engine detects a
// unit. A guard test (classification.service.spec) asserts every `example` matches
// its own `regex`, so the docs can never drift away from the live pattern.
// Exported for the ENGINE-060 ReDoS-safety guard spec (classification.patterns.spec).
export const UNIT_PATTERNS: {
  regex: RegExp;
  confidence: number;
  label: string;
  example: string;
}[] = [
  { regex: /\bcasa\s*0*(\d{1,4})(?!\d)/i, confidence: 0.95, label: 'casa', example: 'casa 34' },
  { regex: /\bunidad\s*0*(\d{1,4})(?!\d)/i, confidence: 0.95, label: 'unidad', example: 'unidad 12' },
  { regex: /\blote\s*0*(\d{1,4})(?!\d)/i, confidence: 0.9, label: 'lote', example: 'lote 8' },
  { regex: /\bc\.?\s*0*(\d{1,4})(?!\d)/i, confidence: 0.85, label: 'c.', example: 'c. 45' },
  { regex: /\bdepto?\.?\s*0*(\d{1,4})(?!\d)/i, confidence: 0.85, label: 'depto', example: 'depto 21' },
  { regex: /#\s*0*(\d{1,4})(?!\d)/i, confidence: 0.8, label: '#', example: '#233' },
];

// `terms` is the human-readable list of keywords/abbreviations each regex matches,
// surfaced read-only by getSystemRulesCatalog() so admins can see exactly what the
// hardcoded concept detection recognizes. A guard test (classification.service.spec)
// asserts every `term` matches its own `regex` — the docs cannot drift from the code.
export const CONCEPT_PATTERNS: { regex: RegExp; concept: string; terms: string[] }[] = [
  // Maintenance abbreviations residents actually write: "mtto", "mmto", "manto",
  // "mantto", "mant", "mto" — the old `mant\b` missed "Mtto"/"MTTO"/"Mmto" (no word
  // boundary after "mant"), and the inner group missed the bare "mto" (single t,
  // e.g. "Concepto del Pago: mto 344"). `\bm(?:antenimiento|antto|anto|tto|mto|to|ant)\b`
  // covers them: the `to` alternative yields the standalone token "mto".
  {
    regex: /mantenimiento|cuota\s+mensual|mensualidad|\bm(?:antenimiento|antto|anto|tto|mto|to|ant)\b/i,
    concept: 'MAINTENANCE',
    terms: ['mantenimiento', 'cuota mensual', 'mensualidad', 'mtto', 'mmto', 'manto', 'mantto', 'mant', 'mto'],
  },
  { regex: /deposito|dep[oó]sito|garant[ií]a/i, concept: 'DEPOSIT', terms: ['depósito', 'deposito', 'garantía'] },
  { regex: /multa|sanci[oó]n|infracci[oó]n/i, concept: 'FINE', terms: ['multa', 'sanción', 'infracción'] },
  { regex: /\bagua\b|\bluz\b|electricidad|internet|\bgas\b/i, concept: 'UTILITY', terms: ['agua', 'luz', 'electricidad', 'internet', 'gas'] },
  { regex: /estacionamiento|parking|caj[oó]n/i, concept: 'PARKING', terms: ['estacionamiento', 'parking', 'cajón'] },
  { regex: /terraza|alberca|sal[oó]n|amenidad/i, concept: 'AMENITY', terms: ['terraza', 'alberca', 'salón', 'amenidad'] },
];

// Stable keys for the hardcoded (non-keyword) passes. Their human-facing title and
// description are localized in the web app by `key`; here we only expose the catalog
// of keys + execution order so the UI can render the engine's full pipeline read-only.
const SYSTEM_BEHAVIORAL_PASSES: { key: string; order: number }[] = [
  { key: 'terraceBooking', order: 1 },
  { key: 'amountGate', order: 2 },
  { key: 'banbajioSegment', order: 3 },
  { key: 'multiHouseSplit', order: 4 },
  { key: 'monthToMaintenance', order: 5 },
  { key: 'fuzzyName', order: 6 },
];

const MONTH_MAP: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may_: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

export const PAYER_PATTERNS: RegExp[] = [
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
    // The generic extractor never resolves multi-unit; only the BanBajío path
    // (findMultipleUnits) does. Single detected unit is mirrored by the caller.
    unitNumbersDetected: unitNumberDetected ? [unitNumberDetected] : [],
    unitConfidence,
    payerNameDetected,
    paymentConcept,
    paymentPeriodYear,
    paymentPeriodMonth,
  };
}

/** Leading number of the segment ("176 dic", "06" -> 6), validated against totalUnits. */
function findLeadingUnit(segment: string, totalUnits: number): string | null {
  const leading = segment.match(/^\s*0*(\d+)/);
  if (!leading) return null;
  const n = parseInt(leading[1], 10);
  return Number.isFinite(n) && n >= 1 && totalUnits > 0 && n <= totalUnits ? String(n) : null;
}

/**
 * Prefixed unit ("casa 176", "CASA 176", "mantenimiento casa 191", "Mmto ... Casa 93"),
 * validated against totalUnits. The first matching prefix wins; an out-of-range match
 * yields null (so "Casa 999" with totalUnits 370 is rejected). The "#"/Recibo prefix is
 * harmless because "| Recibo #" lives outside this segment.
 */
function findPrefixedUnit(segment: string, totalUnits: number): string | null {
  const normalized = normalizeText(segment);
  for (const { regex } of UNIT_PATTERNS) {
    const m = normalized.match(regex);
    if (m) {
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) && n >= 1 && totalUnits > 0 && n <= totalUnits ? String(n) : null;
    }
  }
  return null;
}

/** The lone in-range bare number, skipping 4-digit years. Amount-gated callers only. */
function findBareUnit(segment: string, totalUnits: number): string | null {
  const normalized = normalizeText(segment);
  const inRange = new Set<number>();
  const numRe = /\b0*(\d+)\b/g;
  let mm: RegExpExecArray | null;
  while ((mm = numRe.exec(normalized)) !== null) {
    const raw = mm[1];
    if (/^20\d{2}$/.test(raw)) continue;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1 && totalUnits > 0 && n <= totalUnits) inRange.add(n);
  }
  return inRange.size === 1 ? String([...inRange][0]) : null;
}

/**
 * All in-range units named when a single BanBajío payment covers MORE than one
 * house, e.g. "casas 307 y 43", "casa 307 y 43", "casa 307, 43",
 * "casa 307 y casa 43" -> ["307","43"]. Anchored on a leading "casa(s) <n>" so
 * reference / account / RFC digits elsewhere are never swept in; siblings are
 * picked up after a connector (y / , / & / + / casa(s)). Each number is validated
 * 1..totalUnits, 4-digit years are skipped, and first-seen order is preserved
 * (deduped). Returns [] when there is no "casa(s) <n>" head; a single-house
 * concept yields a one-element array, which the caller treats as the normal case.
 */
function findMultipleUnits(segment: string, totalUnits: number): string[] {
  const normalized = normalizeText(segment);
  const head = normalized.match(/\bcasas?\s*0*(\d{1,4})(?!\d)/);
  if (!head || head.index === undefined) return [];

  const units: string[] = [];
  const seen = new Set<number>();
  const pushIfValid = (raw: string) => {
    if (/^20\d{2}$/.test(raw)) return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || totalUnits <= 0 || n > totalUnits) return;
    if (seen.has(n)) return;
    seen.add(n);
    units.push(String(n));
  };

  pushIfValid(head[1]);
  const tailRe = /(?:y|,|&|\+|casas?)\s*0*(\d{1,4})(?!\d)/g;
  tailRe.lastIndex = head.index + head[0].length;
  let m: RegExpExecArray | null;
  while ((m = tailRe.exec(normalized)) !== null) {
    pushIfValid(m[1]);
  }
  return units;
}

/**
 * The first named month in a segment ("agosto y octubre" -> 8, "Mtto Oct 357" -> 10),
 * matched as a whole word, longest-first so "may" never matches inside a longer token.
 * Shared by extractFromBanBajio (month -> maintenance concept) and parseMaintenanceConcept.
 */
function detectMonth(segment: string): number | null {
  const normalized = normalizeText(segment);
  const monthNames = Object.keys(MONTH_MAP)
    .map((k) => (k === 'may_' ? 'may' : k))
    .sort((a, b) => b.length - a.length);
  const m = normalized.match(new RegExp(`\\b(${monthNames.join('|')})\\b`));
  if (!m) return null;
  const key = m[1] === 'may' ? 'may_' : m[1];
  return MONTH_MAP[key] ?? MONTH_MAP[m[1]] ?? null;
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
  //
  // We accept two safe shapes: the leading number ("176 dic") and an explicit
  // prefixed unit anywhere in the segment ("casa 176", "mantenimiento casa 191",
  // "Mmto Anual 2026 Casa 93" -> 93). A bare number that is NOT at the start is
  // intentionally NOT taken here — that needs the amount corroboration and lives
  // in the maintenance pass (parseMaintenanceConcept / Pass 0.6).
  let unitNumberDetected: string | null = null;
  let unitNumbersDetected: string[] = [];
  let unitConfidence = 0;
  let paymentConcept = base.paymentConcept;

  const segment = description.match(/concepto del pago:\s*([^|]*)/i);
  if (segment) {
    const seg = segment[1];

    // A named month in the concept ("agosto y octubre", "Mtto Oct 357") signals a
    // maintenance payment when no stronger concept keyword was found. Only fills a
    // missing concept — a deposit/fine that happens to name a month keeps its own.
    if (!paymentConcept && detectMonth(seg) !== null) {
      paymentConcept = 'MAINTENANCE';
    }

    // A concept naming several houses ("casas 307 y 43") is a multi-unit payment:
    // surface ALL units in the array and leave the scalar null so nothing tries
    // to auto-link a single resident — the split is decided by the operator.
    const multi = findMultipleUnits(seg, totalUnits);
    if (multi.length >= 2) {
      unitNumbersDetected = multi;
      unitNumberDetected = null;
      unitConfidence = 0.95;
    } else {
      // A single house — whether written "casa 176", glued "casa34", as a leading
      // number "176 dic", or as a multi-form that left only one in-range unit
      // ("casas 307 y 999"). multi[0] already captured the casa-anchored case.
      let single: string | null =
        multi[0] ?? findLeadingUnit(seg, totalUnits) ?? findPrefixedUnit(seg, totalUnits);
      // Maintenance-gated bare number: "Mtto Oct 357" -> 357, "MTTO ... 218 NOV" -> 218.
      // The maintenance concept is what makes a bare number safe here (the same role
      // the amount gate plays in Pass 0.6); findBareUnit still requires a single
      // in-range number and skips 20XX years.
      if (!single && paymentConcept === 'MAINTENANCE') {
        single = findBareUnit(seg, totalUnits);
      }
      if (single) {
        unitNumberDetected = single;
        unitNumbersDetected = [single];
        unitConfidence = 0.95;
      }
    }
  }

  return { ...base, paymentConcept, unitNumberDetected, unitNumbersDetected, unitConfidence };
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

  // Month: shared detector (whole-word, longest-first).
  const month = detectMonth(segMatch[1]);

  // Unit: prefer a prefixed match (casa/unidad/lote/depto), else the lone in-range
  // bare number. The amount gate (Pass 0.6) is what makes the bare case safe.
  const unit = findPrefixedUnit(segment, totalUnits) ?? findBareUnit(segment, totalUnits);

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

// Defense-in-depth cap on the length of a user-provided extraction regex compiled
// at classify time. The DTO `SafeRegexConstraint` is the primary input gate; this
// is the runtime backstop.
const MAX_EXTRACTION_PATTERN_LENGTH = 200;

// Compiles a user-provided regex with RE2 (Google's linear-time engine): unlike the
// JS `RegExp` backtracker, RE2 has no catastrophic-backtracking failure mode, so an
// adversarial or accidental ReDoS pattern can never hang a classification batch.
// Returns null instead of throwing on an invalid / over-long / RE2-unsupported
// pattern (RE2 rejects backreferences + lookaround), so a bad rule degrades to "did
// not fire" rather than aborting the batch — same contract as before, now ReDoS-proof.
function safeCompile(pattern: string, flags: string): RE2 | null {
  if (!pattern || pattern.length > MAX_EXTRACTION_PATTERN_LENGTH) return null;
  try {
    return new RE2(pattern, flags);
  } catch {
    return null;
  }
}

// Resolves a UNIT rule's OUTCOME into a unit string, or null when the rule is not a
// UNIT rule / produced nothing. Flavor 1 (direct assignment) short-circuits; flavor
// 2 (format extraction) runs the capture-group regex against the original
// description and reads the configured group. The returned value is later compared
// to the padrón via `matchToResident` (which normalizes), so no casing work here.
export function resolveRuleUnit(rule: DbRule, description: string): string | null {
  if (rule.ruleKind !== ReconciliationRuleKind.UNIT) return null;
  if (rule.assignedUnitNumber && rule.assignedUnitNumber.trim().length > 0) {
    return rule.assignedUnitNumber.trim();
  }
  if (rule.unitExtractionPattern) {
    const re = safeCompile(rule.unitExtractionPattern, 'i');
    if (!re) return null;
    const match = re.exec(description);
    const group = rule.unitExtractionGroup ?? 1;
    const captured = match?.[group];
    if (captured && captured.trim().length > 0) return captured.trim();
  }
  return null;
}

function applyDbRules(
  description: string,
  rules: DbRule[],
  flowType: FlowType = FlowType.INCOME,
): { matchedRule: DbRule; score: number } | null {
  const normalized = normalizeText(description);

  // Rules only apply to the matching flow: EXPENSE rules (category/supplier
  // outcome) fire on outflows; CONCEPT/UNIT rules (resident-payment outcome) fire
  // on inflows. This keeps an income concept from ever landing on an expense and
  // vice-versa.
  const applicable =
    flowType === FlowType.EXPENSE
      ? rules.filter((r) => r.ruleKind === ReconciliationRuleKind.EXPENSE)
      : rules.filter((r) => r.ruleKind !== ReconciliationRuleKind.EXPENSE);

  for (const rule of applicable) {
    const allKeywordsMatch = rule.keywords.length > 0 &&
      rule.keywords.every((kw) => normalized.includes(normalizeText(kw)));

    const patternMatch = rule.unitPatterns.length > 0 &&
      rule.unitPatterns.some((p) => {
        // RE2 (via safeCompile) keeps trigger matching linear-time + ReDoS-proof.
        const re = safeCompile(p, 'i');
        return re ? re.test(normalized) : false;
      });

    // A UNIT extraction rule needs no separate trigger: it fires precisely when its
    // extraction pattern captures a unit from the description. (Direct-assignment
    // UNIT rules still fire through their keywords/unitPatterns condition.)
    const extractionMatch =
      rule.ruleKind === ReconciliationRuleKind.UNIT &&
      !!rule.unitExtractionPattern &&
      resolveRuleUnit(rule, description) !== null;

    if (
      allKeywordsMatch ||
      (rule.unitPatterns.length > 0 && patternMatch) ||
      extractionMatch
    ) {
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
   * Returns a read-only catalog of the engine's hardcoded logic (concept keywords,
   * unit prefixes, recognized months, behavioral passes), derived directly from the
   * engine constants. Consumed by GET …/reconciliation-rules/system so the UI can
   * show the "reglas del sistema" (built-in, non-editable) next to the editable
   * Pass-0 rules — making the classification engine fully transparent.
   */
  getSystemRulesCatalog(): SystemRulesCatalog {
    const byMonth = new Map<number, string[]>();
    for (const [rawKey, month] of Object.entries(MONTH_MAP)) {
      // `may_` is an internal key that avoids colliding with the English "may";
      // surface it as the real form "may".
      const form = rawKey === 'may_' ? 'may' : rawKey;
      const forms = byMonth.get(month) ?? [];
      if (!forms.includes(form)) forms.push(form);
      byMonth.set(month, forms);
    }

    return {
      conceptPatterns: CONCEPT_PATTERNS.map((p) => ({
        concept: p.concept,
        terms: [...p.terms],
      })),
      unitPatterns: UNIT_PATTERNS.map((p) => ({
        label: p.label,
        example: p.example,
        confidence: p.confidence,
      })),
      months: Array.from(byMonth.entries())
        .sort(([a], [b]) => a - b)
        .map(([month, forms]) => ({ month, forms })),
      behavioralPasses: SYSTEM_BEHAVIORAL_PASSES.map((p) => ({ ...p })),
    };
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
    // Drives which rule kinds apply (EXPENSE rules on outflows, CONCEPT/UNIT on
    // inflows). Defaults to INCOME so existing callers/tests stay unchanged.
    flowType: FlowType = FlowType.INCOME,
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

    // Multi-unit BanBajío payment ("casas 307 y 43"): one credit covering several
    // houses. We surface ALL detected units (the array) but NEVER auto-classify —
    // a single residentId cannot represent N units, and how the amount splits
    // across them is the operator's call (manual PaymentAllocation rows). Short-
    // circuit BEFORE every matching pass so neither a DB rule nor the amount pass
    // (which would otherwise grab the first "casa NNN") can link a resident.
    if (extraction.unitNumbersDetected.length >= 2) {
      return {
        ...extraction,
        unitNumberDetected: null,
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

    // Pass 0: DB-driven rules (priority order, first match wins)
    const ruleMatch = applyDbRules(description, rules, flowType);
    if (ruleMatch) {
      const { matchedRule, score } = ruleMatch;

      // EXPENSE-kind rule: its outcome is a category and/or supplier — never a
      // resident or income concept. Stamp them and short-circuit; an expense is
      // classified by what it bought and who was paid, not by who paid it.
      if (matchedRule.ruleKind === ReconciliationRuleKind.EXPENSE) {
        const isAuto = score >= 0.8;
        return {
          ...extraction,
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

      // UNIT-kind rule: its outcome is a house number. Override the system-detected
      // unit BEFORE resident linkage so the user rule wins over the engine's fixed
      // extractor. The assigned/extracted unit still flows through matchToResident,
      // so a unit absent from the padrón becomes UNIT_NOT_FOUND → NEEDS_REVIEW (never
      // a silent mis-link). The user owns the confidence (web default 0.9 → auto).
      const ruleUnit = resolveRuleUnit(matchedRule, description);
      if (ruleUnit) {
        extraction.unitNumberDetected = ruleUnit;
        extraction.unitNumbersDetected = [ruleUnit];
        extraction.unitConfidence = Number(matchedRule.confidenceThreshold);
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
          extraction.unitNumbersDetected = [unit];
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
          tx.flowType,
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

    let summary: ClassificationSummary;
    try {
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
    await this.prisma.importBatch.updateMany({
      where: { id: batchId, condominiumId },
      data: {
        status: 'COMPLETED',
        completedAt: batch.completedAt ?? new Date(),
        classifiedCount: summary.classified,
        needsReviewCount: summary.needsReview,
        unmatchedCount: summary.unmatched,
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
          tx.flowType,
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
      throw new NotFoundException('Resident not found in this condominium');
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
          ...(dto.expenseCategoryId !== undefined && { expenseCategoryId: dto.expenseCategoryId || null }),
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId || null }),
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
            expenseCategoryId: existingTx.expenseCategoryId,
            supplierId: existingTx.supplierId,
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

      // Amounts must sum to the credit (cents tolerance for rounding).
      const sum = allocations.reduce((acc, a) => acc + Number(a.allocatedAmount), 0);
      if (Math.abs(sum - credit) > 0.01) {
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
          allocatedAmount: new Prisma.Decimal(Number(a.allocatedAmount).toFixed(2)),
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

  // ENGINE-002 — public recompute for callers that delete transactions and
  // must rebuild the official monthly numbers afterwards (imports remove()).
  // The month list is captured by the caller BEFORE deleting, because the
  // batch-scoped variant derives its months from rows that no longer exist.
  async recomputeSummariesForMonths(
    condominiumId: string,
    months: Array<{ year: number; month: number }>,
  ): Promise<void> {
    await Promise.all(
      months.map(({ year, month }) =>
        this.upsertSummaryForMonth(condominiumId, year, month),
      ),
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
