import { normalizeTerraceKeyword, normalizeTerraceKeywordList } from './terrace-keywords.util';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TerraceCandidate {
  id: string;
  residentId: string | null;
  unitNumber: string | null;
  startDate: Date;
  terraceRentalAmount: number;
  /** CAL-012: the booking's security deposit, matched as a distinct amount kind. */
  securityDepositAmount: number;
  /**
   * CAL-012: only an un-settled (PENDING) deposit is still expected, so a
   * deposit-amount match only flags when the deposit has not yet been received.
   */
  securityDepositStatus: 'PENDING' | 'RECEIVED' | 'RETURNED' | 'RETAINED';
  customKeywords: string[];
  /**
   * CAL-003: the booking's rental is already covered by an active (non-IGNORED)
   * transaction — either persisted PAID, linked by an APPROVED/PENDING payment,
   * or claimed by an earlier match in this same run. A further rental-amount
   * match is a duplicate, not a new payment, and must not auto-link.
   */
  claimed: boolean;
}

export interface TerraceMatchInput {
  amount: number;
  transactionDate: Date;
  description: string;
  detectedResidentId: string | null;
  detectedUnitNumber: string | null;
  /**
   * Tenant-level terrace keywords from `CondominiumSettings.terraceGlobalKeywords` (Phase 5F).
   * Merged with the hardcoded `TERRACE_KEYWORDS` and per-candidate `customKeywords` for
   * the keyword signal. Default empty array preserves pre-5F behavior for callers that
   * have not yet been wired to pass the tenant list.
   */
  globalKeywords?: string[];
}

export interface TerraceMatchResult {
  matchedCalendarEventId: string | null;
  residentId: string | null;
  matchSource: 'AUTO_TERRACE_BOOKING';
  confidenceScore: number;
  classificationStatus: 'AUTO' | 'NEEDS_REVIEW';
  requiresReviewReason:
    | 'TERRACE_AMBIGUOUS'
    | 'TERRACE_DUPLICATE'
    | 'TERRACE_DEPOSIT'
    | 'LOW_CONFIDENCE'
    | null;
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

const normalizeStr = normalizeTerraceKeyword;

function hasTerraceKeyword(
  normalizedDescription: string,
  candidateKeywords: string[] = [],
  globalKeywords: string[] = [],
): boolean {
  return (
    TERRACE_KEYWORDS.some((kw) => normalizedDescription.includes(kw)) ||
    globalKeywords.some((kw) => normalizedDescription.includes(kw)) ||
    candidateKeywords.some((kw) => normalizedDescription.includes(kw))
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
 * Callers pre-filter candidates to TERRACE_BOOKING events that are not CANCELLED and
 * not deleted. Unlike phase 1, the pool now also includes claimed bookings (PAID, or
 * already linked by an active payment) so a duplicate payment can be detected (CAL-003);
 * such candidates carry `claimed: true` and never auto-link.
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
  // Pre-normalize tenant-level keywords once so the per-candidate loop stays cheap.
  // Phase 5F: merged into the keyword signal alongside hardcoded TERRACE_KEYWORDS
  // and the per-candidate customKeywords already pre-normalized by the metadata validator.
  const normalizedGlobalKeywords = normalizeTerraceKeywordList(input.globalKeywords ?? []);

  // Step 1: keep candidates whose RENTAL or (un-settled) DEPOSIT amount matches and
  // whose date is in window. CAL-012: tracking which amount kind matched lets the
  // winner branch route deposit-sized payments to review instead of auto-linking
  // them as rental.
  const amountAndDateMatches = candidates
    .map((c) => {
      const rentalMatch = amountMatches(input.amount, c.terraceRentalAmount);
      const depositMatch =
        c.securityDepositStatus === 'PENDING' &&
        amountMatches(input.amount, c.securityDepositAmount);
      return { candidate: c, rentalMatch, depositMatch };
    })
    .filter(
      (m) =>
        (m.rentalMatch || m.depositMatch) &&
        inDateWindow(input.transactionDate, m.candidate.startDate),
    );

  if (amountAndDateMatches.length === 0) return null;

  // Step 2: score each candidate by supporting signals.
  const scored = amountAndDateMatches.map((m) => {
    const c = m.candidate;
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

    const keywordSignal = hasTerraceKeyword(normalizedDesc, c.customKeywords, normalizedGlobalKeywords);
    if (keywordSignal) score += SIGNAL_KEYWORD;

    return { candidate: c, score, residentSignal, unitSignal, depositMatch: m.depositMatch };
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

  // CAL-012: the amount matches the booking's security deposit (or rental == deposit,
  // so the two cannot be told apart). Deposits have no auto-link / engine payment path,
  // so never mark the rental PAID off a deposit-sized payment — route to the operator.
  if (winner.depositMatch) {
    return {
      matchedCalendarEventId: null,
      residentId: null,
      matchSource: 'AUTO_TERRACE_BOOKING',
      confidenceScore: 0.60,
      classificationStatus: 'NEEDS_REVIEW',
      requiresReviewReason: 'TERRACE_DEPOSIT',
      paymentConcept: 'AMENITY',
      matchedAt: null,
    };
  }

  // CAL-003: the winning booking's rental is already covered by an active payment
  // (persisted PAID, or linked earlier in this same run). A second same-amount
  // transaction is a duplicate, not a new payment — surface it for the operator
  // instead of silently double-absorbing the income against the same booking.
  if (winner.candidate.claimed) {
    return {
      matchedCalendarEventId: null,
      residentId: null,
      matchSource: 'AUTO_TERRACE_BOOKING',
      confidenceScore: 0.60,
      classificationStatus: 'NEEDS_REVIEW',
      requiresReviewReason: 'TERRACE_DUPLICATE',
      paymentConcept: 'AMENITY',
      matchedAt: null,
    };
  }

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
