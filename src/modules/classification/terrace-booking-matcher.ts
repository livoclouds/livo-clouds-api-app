// ─── Types ────────────────────────────────────────────────────────────────────

export interface TerraceCandidate {
  id: string;
  residentId: string | null;
  unitNumber: string | null;
  startDate: Date;
  terraceRentalAmount: number;
  customKeywords: string[];
}

export interface TerraceMatchInput {
  amount: number;
  transactionDate: Date;
  description: string;
  detectedResidentId: string | null;
  detectedUnitNumber: string | null;
}

export interface TerraceMatchResult {
  matchedCalendarEventId: string | null;
  residentId: string | null;
  matchSource: 'AUTO_TERRACE_BOOKING';
  confidenceScore: number;
  classificationStatus: 'AUTO' | 'NEEDS_REVIEW';
  requiresReviewReason: 'TERRACE_AMBIGUOUS' | 'LOW_CONFIDENCE' | null;
  paymentConcept: 'AMENITY';
  matchedAt: Date | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Transaction must arrive within this many days before the event date. */
export const TERRACE_DATE_WINDOW_DAYS = 30;

const TERRACE_KEYWORDS = [
  'terraza', 'terrace', 'salon', 'amenidad', 'amenity',
  'reserva', 'reservacion', 'reservation', 'evento',
];

// Signal weights — resident or unit match each carry 2 points; keyword carries 1.
const SIGNAL_RESIDENT = 2;
const SIGNAL_UNIT = 2;
const SIGNAL_KEYWORD = 1;

// Minimum total signal score required to produce any match result.
const MIN_SIGNAL_FOR_MATCH = 1;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeStr(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTerraceKeyword(normalizedDescription: string, extraKeywords: string[] = []): boolean {
  return (
    TERRACE_KEYWORDS.some((kw) => normalizedDescription.includes(kw)) ||
    extraKeywords.some((kw) => normalizedDescription.includes(kw))
  );
}

function amountMatches(txAmount: number, eventAmount: number): boolean {
  // Exact match only in phase 1. Amounts are floating-point from Prisma Decimal.toNumber()
  // so we compare within a tiny epsilon to guard against floating-point drift.
  return Math.abs(txAmount - eventAmount) < 0.005;
}

function inDateWindow(transactionDate: Date, eventStartDate: Date): boolean {
  const windowStart = new Date(eventStartDate);
  windowStart.setDate(windowStart.getDate() - TERRACE_DATE_WINDOW_DAYS);
  // Normalize to UTC day boundaries for comparison.
  const txDay = Date.UTC(
    transactionDate.getUTCFullYear(),
    transactionDate.getUTCMonth(),
    transactionDate.getUTCDate(),
  );
  const windowStartDay = Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    windowStart.getUTCDate(),
  );
  const eventDay = Date.UTC(
    eventStartDate.getUTCFullYear(),
    eventStartDate.getUTCMonth(),
    eventStartDate.getUTCDate(),
  );
  return txDay >= windowStartDay && txDay <= eventDay;
}

// ─── Main matching function ───────────────────────────────────────────────────

/**
 * Pure function — no DB access. Evaluates a list of active, non-cancelled TERRACE_BOOKING
 * events against a single transaction and returns the best match, or null if no match is
 * strong enough to warrant any action.
 *
 * Callers are responsible for pre-filtering candidates: only pass events that are
 * TERRACE_BOOKING, not CANCELLED, not deleted, and have paymentStatus === 'PENDING'.
 *
 * The transaction must be INCOME (terrace rental is always received income).
 */
export function matchTerraceBooking(
  input: TerraceMatchInput,
  candidates: TerraceCandidate[],
): TerraceMatchResult | null {
  const normalizedDesc = normalizeStr(input.description);
  const normalizedDetectedUnit = input.detectedUnitNumber
    ? normalizeStr(input.detectedUnitNumber)
    : null;

  // Step 1: filter to candidates with matching amount and date in window.
  const amountAndDateMatches = candidates.filter(
    (c) => amountMatches(input.amount, c.terraceRentalAmount) && inDateWindow(input.transactionDate, c.startDate),
  );

  if (amountAndDateMatches.length === 0) return null;

  // Step 2: score each candidate by supporting signals.
  const scored = amountAndDateMatches.map((c) => {
    let score = 0;

    const residentSignal =
      input.detectedResidentId !== null &&
      c.residentId !== null &&
      input.detectedResidentId === c.residentId;
    if (residentSignal) score += SIGNAL_RESIDENT;

    const unitSignal =
      normalizedDetectedUnit !== null &&
      c.unitNumber !== null &&
      normalizedDetectedUnit === normalizeStr(c.unitNumber);
    if (unitSignal) score += SIGNAL_UNIT;

    const keywordSignal = hasTerraceKeyword(normalizedDesc, c.customKeywords);
    if (keywordSignal) score += SIGNAL_KEYWORD;

    return { candidate: c, score, residentSignal, unitSignal };
  });

  // Step 3: discard candidates with no supporting signals (amount + date only).
  const withSignals = scored.filter((s) => s.score >= MIN_SIGNAL_FOR_MATCH);

  if (withSignals.length === 0) return null;

  // Step 4: find the best-scoring candidates.
  const maxScore = Math.max(...withSignals.map((s) => s.score));
  const best = withSignals.filter((s) => s.score === maxScore);

  // Step 5: ambiguity check — multiple events tie at the top score.
  if (best.length > 1) {
    return {
      matchedCalendarEventId: null,
      residentId: null,
      matchSource: 'AUTO_TERRACE_BOOKING',
      confidenceScore: 0.60,
      classificationStatus: 'NEEDS_REVIEW',
      requiresReviewReason: 'TERRACE_AMBIGUOUS',
      paymentConcept: 'AMENITY',
      matchedAt: null,
    };
  }

  const winner = best[0];

  // Step 6: classify based on which signals fired.
  if (winner.residentSignal && winner.unitSignal) {
    // Resident + unit — strongest match.
    return {
      matchedCalendarEventId: winner.candidate.id,
      residentId: winner.candidate.residentId,
      matchSource: 'AUTO_TERRACE_BOOKING',
      confidenceScore: 0.95,
      classificationStatus: 'AUTO',
      requiresReviewReason: null,
      paymentConcept: 'AMENITY',
      matchedAt: new Date(),
    };
  }

  if (winner.residentSignal) {
    // Resident match only.
    return {
      matchedCalendarEventId: winner.candidate.id,
      residentId: winner.candidate.residentId,
      matchSource: 'AUTO_TERRACE_BOOKING',
      confidenceScore: 0.90,
      classificationStatus: 'AUTO',
      requiresReviewReason: null,
      paymentConcept: 'AMENITY',
      matchedAt: new Date(),
    };
  }

  if (winner.unitSignal) {
    // Unit match only.
    return {
      matchedCalendarEventId: winner.candidate.id,
      residentId: null,
      matchSource: 'AUTO_TERRACE_BOOKING',
      confidenceScore: 0.88,
      classificationStatus: 'AUTO',
      requiresReviewReason: null,
      paymentConcept: 'AMENITY',
      matchedAt: new Date(),
    };
  }

  // Keyword only (score === SIGNAL_KEYWORD === 1) — weak signal, needs review.
  return {
    matchedCalendarEventId: winner.candidate.id,
    residentId: null,
    matchSource: 'AUTO_TERRACE_BOOKING',
    confidenceScore: 0.70,
    classificationStatus: 'NEEDS_REVIEW',
    requiresReviewReason: 'LOW_CONFIDENCE',
    paymentConcept: 'AMENITY',
    matchedAt: null,
  };
}
