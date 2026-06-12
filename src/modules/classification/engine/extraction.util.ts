// Pure extraction/matching engine (ENGINE-008 decomposition, Phase 6).
// Everything in this module is side-effect-free: the hardcoded pattern
// constants, the text extractors, the rule/correction data shapes, and the
// resident matcher. `classification.service.ts` re-exports the public symbols
// so existing imports (specs, imports.service) keep working unchanged.

// `re2` is a CommonJS module that uses `export = RE2`; with esModuleInterop off,
// import-equals is the form that resolves to the constructor at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import RE2 = require('re2');
import { MatchSource, ClassificationStatus, RequiresReviewReason, ReconciliationRuleKind, FlowType, Prisma } from '@prisma/client';

export interface ResidentData {
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

export interface TextExtraction {
  unitNumberDetected: string | null;
  // All units named when a single payment covers MORE than one house
  // ("casas 307 y 43"). Single-unit detection populates this with one element;
  // the scalar `unitNumberDetected` stays as the 1:1 primary (null for multi).
  unitNumbersDetected: string[];
  unitConfidence: number;
  // ENGINE-042: which hardcoded pattern produced the detected unit — a
  // UNIT_PATTERNS label ("casa", "#", …) or a BanBajío stage label
  // ("banbajio:segment", "banbajio:amount-gate"). Null when no pattern fired or
  // when a rule/correction supplied the unit (matchedRuleId / matchSource
  // attribute those). Persisted on the transaction so the metrics service can
  // compute override rates per pattern.
  matchedPatternLabel: string | null;
  payerNameDetected: string | null;
  paymentConcept: string | null;
  paymentPeriodYear: number | null;
  paymentPeriodMonth: number | null;
}

// ENGINE-043: the stored outcome of a recurring manual correction
// (ReconciliationCorrectionPattern row), re-applied by the learned-correction
// pass when the same description recurs.
export interface CorrectionPatternData {
  selectedUnitNumber: string | null;
  selectedResidentId: string | null;
  selectedConcept: string | null;
}

export interface MatchResult {
  residentId: string | null;
  matchSource: MatchSource | null;
  confidenceScore: number;
  classificationStatus: ClassificationStatus;
  requiresReviewReason: RequiresReviewReason | null;
  matchedRuleId: string | null;
  matchedCalendarEventId: string | null;
  matchedAt: Date | null;
  // CAL-037: the tied candidate event ids when the terrace matcher returns
  // TERRACE_AMBIGUOUS. Optional so the non-terrace return paths stay valid;
  // defaults to [] at persistence. Lets the review UI list the competing bookings.
  terraceCandidateEventIds?: string[];
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
  // ENGINE-018: rows the engine declined to overwrite because their status
  // changed mid-run (manual classification/approval during a long re-run).
  skipped: number;
  // ENGINE-003: rows excluded from a reclassify reset because they carry a
  // manual override or are already reconciled. Only set by reclassifyBatch.
  preservedManual?: number;
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
//
// Confidence calibration (ENGINE-042 / ENGINE-001). The tiers below are the
// engine's precision model; the fixed 0.8 AUTO gate (matchToResident) decides
// auto-link vs LOW_CONFIDENCE review:
//   casa / unidad 0.95, lote 0.90, depto 0.85 — EXPECTED basis (explicit
//     residential prefixes; heuristic estimates pending measured override rates).
//   c. 0.70, # 0.60 — DEMOTED below the AUTO gate (ENGINE-001): both prefixes
//     match bank reference numbers ("FOLIO # 123", "C. 0045 REF") and were
//     silently mis-attributing payments; they now always land in review. This
//     also guarantees at least two tiers sit below the gate by design, making
//     LOW_CONFIDENCE reachable from system patterns.
// Measured override rates per pattern (the empirical basis to recalibrate these
// constants) come from GET …/classification/precision → `byPattern`, fed by the
// persisted `matchedPatternLabel` (attribution starts at Phase 4 deploy).
export const UNIT_PATTERNS: {
  regex: RegExp;
  confidence: number;
  label: string;
  example: string;
}[] = [
  { regex: /\bcasa\s*0*(\d{1,4})(?!\d)/i, confidence: 0.95, label: 'casa', example: 'casa 34' },
  { regex: /\bunidad\s*0*(\d{1,4})(?!\d)/i, confidence: 0.95, label: 'unidad', example: 'unidad 12' },
  { regex: /\blote\s*0*(\d{1,4})(?!\d)/i, confidence: 0.9, label: 'lote', example: 'lote 8' },
  { regex: /\bc\.?\s*0*(\d{1,4})(?!\d)/i, confidence: 0.7, label: 'c.', example: 'c. 45' },
  { regex: /\bdepto?\.?\s*0*(\d{1,4})(?!\d)/i, confidence: 0.85, label: 'depto', example: 'depto 21' },
  { regex: /#\s*0*(\d{1,4})(?!\d)/i, confidence: 0.6, label: '#', example: '#233' },
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
//
// ENGINE-046: this order MUST mirror the real execution order in
// classifyTransaction (extraction → multi-house short-circuit → terrace →
// editable rules → learned corrections → amount gate → fuzzy name). A guard
// spec pins the catalog against the pipeline, so reordering one without the
// other fails the build.
export const SYSTEM_BEHAVIORAL_PASSES: { key: string; order: number }[] = [
  { key: 'banbajioSegment', order: 1 },
  { key: 'monthToMaintenance', order: 2 },
  { key: 'multiHouseSplit', order: 3 },
  { key: 'terraceBooking', order: 4 },
  { key: 'correctionPattern', order: 5 },
  { key: 'amountGate', order: 6 },
  { key: 'fuzzyName', order: 7 },
];

const MONTH_MAP: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may_: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

// ENGINE-012: the month-name alternation is derived from MONTH_MAP and used by
// every row's extraction — hoisted to module constants instead of being
// rebuilt (sort + join + new RegExp) on every call. No `g` flag, so the
// compiled regexes are stateless and safe to share.
const MONTH_NAMES_LONGEST_FIRST = Object.keys(MONTH_MAP)
  .map((k) => (k === 'may_' ? 'may' : k))
  .sort((a, b) => b.length - a.length);
const NAMED_PERIOD_RE = new RegExp(
  `\\b(${MONTH_NAMES_LONGEST_FIRST.join('|')})\\b[\\s/\\-]+(20\\d{2})\\b`,
);
const MONTH_WORD_RE = new RegExp(`\\b(${MONTH_NAMES_LONGEST_FIRST.join('|')})\\b`);

export const PAYER_PATTERNS: RegExp[] = [
  /nombre:\s*([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+ref|\s+\d|$)/i,
  /de:\s*([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+ref|\s+\d|$)/i,
  /pago\s+de\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+casa|\s+unidad|\s+c\d|\s+\d|$)/i,
];

export function normalizeText(text: string): string {
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

/**
 * ENGINE-044: token-order-insensitive name similarity. Bank payer strings are
 * routinely "LASTNAME FIRSTNAME" while the padrón stores "First Last", so raw
 * Levenshtein over the joined strings scores token-order variants below the
 * candidate cutoff ("PEREZ JUAN" vs "juan perez" ≈ 0.2). Comparing the
 * whitespace tokens SORTED and rejoined makes the metric order-invariant while
 * keeping Levenshtein's tolerance for typos inside each token.
 */
function tokenSetSimilarity(a: string, b: string): number {
  const sortTokens = (s: string) => s.split(' ').filter(Boolean).sort().join(' ');
  return levenshteinSimilarity(sortTokens(a), sortTokens(b));
}

/**
 * Generic (bank-agnostic) extractor. `totalUnits` (ENGINE-001) bounds every
 * detected unit to the condominium's configured range 1..totalUnits — an
 * out-of-range capture is discarded and the NEXT pattern gets a chance, so
 * "casa 9999" never links and "FOLIO # 123" can only link when 123 is a real
 * unit (and even then the demoted "#" confidence keeps it in review).
 * `totalUnits <= 0` (unconfigured tenant) skips the range check — the legacy
 * behavior every existing caller without settings relies on.
 */
export function extractFromText(description: string, totalUnits = 0): TextExtraction {
  const normalized = normalizeText(description);

  // ENGINE-014: multi-house detection is bank-agnostic. A description naming
  // >= 2 in-range units ("casa 307 y casa 43") surfaces ALL of them and leaves
  // the scalar null, so the caller's multi-unit short-circuit applies under any
  // bank profile. findMultipleUnits requires totalUnits > 0 (range-validated by
  // design), so unconfigured tenants keep single-unit behavior.
  const multi = findMultipleUnits(normalized, totalUnits);
  if (multi.length >= 2) {
    return {
      unitNumberDetected: null,
      unitNumbersDetected: multi,
      unitConfidence: 0.95,
      matchedPatternLabel: 'casa',
      payerNameDetected: extractPayerName(description),
      ...extractConceptAndPeriod(normalized),
    };
  }

  let unitNumberDetected: string | null = null;
  let unitConfidence = 0;
  let matchedPatternLabel: string | null = null;
  for (const { regex, confidence, label } of UNIT_PATTERNS) {
    const match = normalized.match(regex);
    if (!match) continue;
    // ENGINE-001: range-validate the captured number when the tenant has
    // totalUnits configured; an out-of-range capture falls through to the
    // next pattern instead of poisoning the row with a wrong unit.
    if (totalUnits > 0) {
      const n = parseInt(match[1], 10);
      if (!Number.isFinite(n) || n < 1 || n > totalUnits) continue;
    }
    unitNumberDetected = match[1].toUpperCase();
    unitConfidence = confidence;
    matchedPatternLabel = label;
    break;
  }

  return {
    unitNumberDetected,
    unitNumbersDetected: unitNumberDetected ? [unitNumberDetected] : [],
    unitConfidence,
    matchedPatternLabel,
    payerNameDetected: extractPayerName(description),
    ...extractConceptAndPeriod(normalized),
  };
}

/** Concept keyword + payment period detection over the normalized description. */
function extractConceptAndPeriod(normalized: string): {
  paymentConcept: string | null;
  paymentPeriodYear: number | null;
  paymentPeriodMonth: number | null;
} {
  let paymentConcept: string | null = null;
  for (const { regex, concept } of CONCEPT_PATTERNS) {
    if (regex.test(normalized)) {
      paymentConcept = concept;
      break;
    }
  }

  let paymentPeriodMonth: number | null = null;
  let paymentPeriodYear: number | null = null;
  const namedPeriod = normalized.match(NAMED_PERIOD_RE);
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

  return { paymentConcept, paymentPeriodYear, paymentPeriodMonth };
}

/** First PAYER_PATTERNS capture over the RAW description (casing preserved). */
function extractPayerName(description: string): string | null {
  for (const pattern of PAYER_PATTERNS) {
    const match = description.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
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
  const m = normalized.match(MONTH_WORD_RE);
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
  const base = extractFromText(description, totalUnits);

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
  // The unit (if any) comes from the segment logic below, never from the base
  // extractor — so the pattern attribution is the BanBajío stage, not a
  // UNIT_PATTERNS label (ENGINE-042).
  let matchedPatternLabel: string | null = null;
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
      matchedPatternLabel = 'banbajio:segment';
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
        matchedPatternLabel = 'banbajio:segment';
      }
    }
  }

  return {
    ...base,
    paymentConcept,
    unitNumberDetected,
    unitNumbersDetected,
    unitConfidence,
    matchedPatternLabel,
  };
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

/**
 * ENGINE-012: per-run memo for compiled rule regexes, keyed `${flags}:${pattern}`.
 * classifyBatch / reclassifyBatch / reapplyToPending create one Map per run and
 * thread it down, so each rule pattern is RE2-compiled once per run instead of
 * once per transaction (O(rows × patterns) native constructor calls). Failed
 * compiles are cached as null too — a bad pattern is also only attempted once.
 */
export type RegexCache = Map<string, RE2 | null>;

// Compiles a user-provided regex with RE2 (Google's linear-time engine): unlike the
// JS `RegExp` backtracker, RE2 has no catastrophic-backtracking failure mode, so an
// adversarial or accidental ReDoS pattern can never hang a classification batch.
// Returns null instead of throwing on an invalid / over-long / RE2-unsupported
// pattern (RE2 rejects backreferences + lookaround), so a bad rule degrades to "did
// not fire" rather than aborting the batch — same contract as before, now ReDoS-proof.
export function safeCompile(pattern: string, flags: string, cache?: RegexCache): RE2 | null {
  if (!pattern || pattern.length > MAX_EXTRACTION_PATTERN_LENGTH) return null;
  const key = `${flags}:${pattern}`;
  if (cache?.has(key)) return cache.get(key) ?? null;
  let re: RE2 | null;
  try {
    re = new RE2(pattern, flags);
  } catch {
    re = null;
  }
  cache?.set(key, re);
  return re;
}

// Resolves a UNIT rule's OUTCOME into a unit string, or null when the rule is not a
// UNIT rule / produced nothing. Flavor 1 (direct assignment) short-circuits; flavor
// 2 (format extraction) runs the capture-group regex against the original
// description and reads the configured group. The returned value is later compared
// to the padrón via `matchToResident` (which normalizes), so no casing work here.
export function resolveRuleUnit(
  rule: DbRule,
  description: string,
  cache?: RegexCache,
): string | null {
  if (rule.ruleKind !== ReconciliationRuleKind.UNIT) return null;
  if (rule.assignedUnitNumber && rule.assignedUnitNumber.trim().length > 0) {
    return rule.assignedUnitNumber.trim();
  }
  if (rule.unitExtractionPattern) {
    const re = safeCompile(rule.unitExtractionPattern, 'i', cache);
    if (!re) return null;
    const match = re.exec(description);
    const group = rule.unitExtractionGroup ?? 1;
    const captured = match?.[group];
    if (captured && captured.trim().length > 0) return captured.trim();
  }
  return null;
}

export function applyDbRules(
  description: string,
  rules: DbRule[],
  flowType: FlowType = FlowType.INCOME,
  cache?: RegexCache,
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
        const re = safeCompile(p, 'i', cache);
        return re ? re.test(normalized) : false;
      });

    // A UNIT extraction rule needs no separate trigger: it fires precisely when its
    // extraction pattern captures a unit from the description. (Direct-assignment
    // UNIT rules still fire through their keywords/unitPatterns condition.)
    const extractionMatch =
      rule.ruleKind === ReconciliationRuleKind.UNIT &&
      !!rule.unitExtractionPattern &&
      resolveRuleUnit(rule, description, cache) !== null;

    if (
      allKeywordsMatch ||
      (rule.unitPatterns.length > 0 && patternMatch) ||
      extractionMatch
    ) {
      // ENGINE-015: confidenceThreshold is the confidence ASSIGNED to this
      // rule's matches (it becomes the emitted score); the engine's fixed 0.8
      // AUTO gate then decides auto vs review. The field name is historical —
      // it is NOT a per-rule gate the score is compared against.
      return { matchedRule: rule, score: Number(rule.confidenceThreshold) };
    }
  }

  return null;
}

export function deriveResidentIdFromUnit(
  unitNumberDetected: string | null,
  residents: ResidentData[],
): string | null {
  if (!unitNumberDetected) return null;
  const target = normalizeText(unitNumberDetected);
  const matches = residents.filter((r) => normalizeText(r.unitNumber) === target);
  return matches.length === 1 ? matches[0].id : null;
}

export function matchToResident(
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

    // Cutoff calibration (ENGINE-042/044): 0.75 admits a candidate (typo-level
    // distance on the sorted tokens), 0.8 (below) auto-links a SINGLE candidate;
    // both are heuristic estimates pending measured override rates from
    // GET …/classification/precision. Multi-candidate always blocks
    // (NAME_AMBIGUOUS), regardless of score.
    for (const r of residents) {
      const fullName = normalizeText(`${r.firstName} ${r.lastName}`);
      const score = tokenSetSimilarity(normalizedPayer, fullName);
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

/**
 * Builds the read-only catalog of the engine's hardcoded logic (concept
 * keywords, unit prefixes, recognized months, behavioral passes), derived
 * directly from the engine constants. Surfaced by
 * ClassificationService.getSystemRulesCatalog().
 */
export function buildSystemRulesCatalog(): SystemRulesCatalog {
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
