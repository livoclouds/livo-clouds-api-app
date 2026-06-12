// Explainable financial-health score for the resident 360 profile (Fase 3).
//
// This is intentionally NOT a black box: it is a deterministic, documented
// weighting of strictly objective inputs, and it returns the raw value behind
// every factor so the UI can always show *why* the score is what it is. It makes
// no subjective judgement about the person — only about the account.
//
// Moved server-side in Fase 3 (the web no longer computes it) and expanded from
// 3 to 7 factors. Pure + deterministic: `now` is injected so it is testable.
//
// Contract notes (Fase 6 — RP-028/029/030):
//  • Precision: factor weight/contribution/rawValue carry 2-decimal precision
//    (round2) so the displayed breakdown reconciles with the score; only the
//    headline `score` is a 0–100 integer.
//  • Time semantics: all period math ("as of" boundaries, delinquency age) is
//    computed in UTC (getUTC*/Date.UTC). Period keys are year*12+month.
//  • Status handling per factor:
//      - onTime / recurrence / trend  → count only PAID_ON_TIME, PAID_LATE,
//        PARTIAL, UNPAID; PENDING/ADJUSTMENT/EXTRAORDINARY/AGREEMENT excluded.
//      - collectionRate               → excludes AGREEMENT (debt under a
//        negotiated plan, not a missed obligation); EXTRAORDINARY counts.
//      - balance                      → AGREEMENT net is removed from the
//        scoring balance (under-management); EXTRAORDINARY counts. The DISPLAYED
//        account-statement balance / Balance KPI is untouched — this adjustment
//        is internal to the score only.

export type HealthBand = "excellent" | "good" | "watch" | "at_risk";

export type HealthFactorUnit = "percent" | "months" | "currency" | "signedPercent";

export type HealthFactorKey =
  | "onTime"
  | "collectionRate"
  | "monthsCurrent"
  | "delinquencyAge"
  | "balance"
  | "recurrence"
  | "trend";

export interface HealthFactor {
  key: HealthFactorKey;
  weight: number;
  contribution: number;
  rawValue: number;
  unit: HealthFactorUnit;
}

export interface FinancialHealth {
  score: number;
  band: HealthBand;
  hasData: boolean;
  factors: HealthFactor[];
}

export interface ScoreHistoryPoint {
  year: number;
  month: number;
  score: number;
  band: HealthBand;
}

// Minimal shapes so the util never depends on Prisma types (amounts already
// coerced to numbers by the caller).
export interface ScoreSummaryInput {
  totalPaid: number;
  totalExpected: number;
  monthsPaid: number;
  monthsUnpaid: number;
  // Outstanding debt: POSITIVE = the resident owes, negative = credit.
  balance: number;
}

export interface ScoreRecordInput {
  year: number;
  month: number;
  status: string;
  amountPaid: number;
  amountExpected: number;
}

// Documented default weights — sum to 100. Per-condominium overrides (Fase 4) are
// stored on CondominiumSettings and auto-normalized to 100 at compute time.
export const HEALTH_WEIGHTS: Record<HealthFactorKey, number> = {
  onTime: 22,
  collectionRate: 16,
  monthsCurrent: 14,
  delinquencyAge: 14,
  balance: 10,
  recurrence: 12,
  trend: 12,
};

export const FACTOR_KEYS: HealthFactorKey[] = [
  "onTime",
  "collectionRate",
  "monthsCurrent",
  "delinquencyAge",
  "balance",
  "recurrence",
  "trend",
];

// True when `input` is a complete, non-negative weight set with a positive sum
// (so it can be normalized). Anything else falls back to the defaults.
export function isValidWeights(input: unknown): input is Record<HealthFactorKey, number> {
  if (!input || typeof input !== "object") return false;
  const w = input as Record<string, unknown>;
  let sum = 0;
  for (const k of FACTOR_KEYS) {
    const v = w[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return false;
    sum += v;
  }
  return sum > 0;
}

// Scales a raw weight set so the seven weights sum to 100 (relative importances →
// points), keeping the score 0–100 and the factor breakdown explainable. Falls
// back to the documented defaults when the input is invalid.
export function normalizeWeights(
  raw: Record<HealthFactorKey, number> = HEALTH_WEIGHTS,
): Record<HealthFactorKey, number> {
  const source = isValidWeights(raw) ? raw : HEALTH_WEIGHTS;
  const sum = FACTOR_KEYS.reduce((s, k) => s + source[k], 0);
  const out = {} as Record<HealthFactorKey, number>;
  for (const k of FACTOR_KEYS) out[k] = (source[k] / sum) * 100;
  return out;
}

// Thresholds where factors bottom out.
const UNPAID_FLOOR = 6; // months unpaid → monthsCurrent hits 0
const DELINQUENCY_AGE_FLOOR = 12; // months overdue → delinquencyAge hits 0
const RECURRENCE_WINDOW = 12; // months looked back for chronicity
const RECURRENCE_FLOOR = 6; // problem months in window → recurrence hits 0
const TREND_WINDOW = 6; // months per trend window (recent vs prior)

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function bandFor(score: number): HealthBand {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "watch";
  return "at_risk";
}

// Canonical status tokens (defensive against casing: API enums are UPPER_SNAKE).
function norm(status: string): string {
  return String(status).toUpperCase();
}
const ON_TIME = "PAID_ON_TIME";
const LATE = "PAID_LATE";
const PARTIAL = "PARTIAL";
const UNPAID = "UNPAID";
const AGREEMENT = "AGREEMENT";
// PENDING/ADJUSTMENT/EXTRAORDINARY/AGREEMENT are excluded from punctuality — not
// yet due or not a punctuality signal — so an agreement never drags the ratio.
const COUNTED = new Set([ON_TIME, LATE, PARTIAL, UNPAID]);
const PROBLEM = new Set([LATE, PARTIAL, UNPAID]);

// 2-decimal rounding — keeps the factor breakdown precise (summed contributions
// reconcile with the score) without noisy floating-point tails (RP-028).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Net amount tied up in AGREEMENT (convenio) months: expected − paid. Removed
// from the score's balance interpretation so a resident actively paying a
// negotiated plan is not scored as a raw defaulter (RP-030).
function agreementNet(records: ScoreRecordInput[]): number {
  return records
    .filter((r) => norm(r.status) === AGREEMENT)
    .reduce((s, r) => s + (r.amountExpected - r.amountPaid), 0);
}

function consideredMonths(records: ScoreRecordInput[]): number {
  return records.filter((r) => COUNTED.has(norm(r.status))).length;
}

function onTimeRatio(records: ScoreRecordInput[]): number | null {
  const considered = consideredMonths(records);
  if (considered === 0) return null;
  const onTime = records.filter((r) => norm(r.status) === ON_TIME).length;
  return onTime / considered;
}

// Sorted descending by period (most recent first).
function sortedDesc(records: ScoreRecordInput[]): ScoreRecordInput[] {
  return [...records].sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month));
}

// Age in whole months of the oldest still-unpaid month relative to `asOf`, or 0
// when nothing is unpaid.
function oldestUnpaidAge(records: ScoreRecordInput[], asOf: Date): number {
  const unpaid = records.filter((r) => norm(r.status) === UNPAID);
  if (unpaid.length === 0) return 0;
  let oldest = unpaid[0];
  for (const r of unpaid) {
    if (r.year * 12 + r.month < oldest.year * 12 + oldest.month) oldest = r;
  }
  const age =
    (asOf.getUTCFullYear() - oldest.year) * 12 +
    (asOf.getUTCMonth() + 1 - oldest.month);
  return Math.max(0, age);
}

// Problem months among the most recent RECURRENCE_WINDOW counted months.
function recentProblemCount(records: ScoreRecordInput[]): number {
  const counted = sortedDesc(records).filter((r) => COUNTED.has(norm(r.status)));
  return counted
    .slice(0, RECURRENCE_WINDOW)
    .filter((r) => PROBLEM.has(norm(r.status))).length;
}

// On-time ratio of the most recent window minus the window before it. Positive =
// improving, negative = worsening. 0 when there is no prior window to compare.
function trendDelta(records: ScoreRecordInput[]): number {
  const counted = sortedDesc(records).filter((r) => COUNTED.has(norm(r.status)));
  if (counted.length < TREND_WINDOW + 1) return 0;
  const recent = counted.slice(0, TREND_WINDOW);
  const prior = counted.slice(TREND_WINDOW, TREND_WINDOW * 2);
  if (prior.length === 0) return 0;
  const ratio = (set: ScoreRecordInput[]) =>
    set.filter((r) => norm(r.status) === ON_TIME).length / set.length;
  return ratio(recent) - ratio(prior);
}

// Historical collection rate from the records themselves (amount paid vs
// expected) — internally consistent with the derived history. AGREEMENT
// (convenio) months are EXCLUDED: that debt is under a negotiated plan, not a
// missed obligation, so it must not drag the rate. EXTRAORDINARY (special
// assessments) ARE included — they are real obligations (RP-030).
function collectionRateOf(records: ScoreRecordInput[]): number {
  const counted = records.filter((r) => norm(r.status) !== AGREEMENT);
  const expected = counted.reduce((s, r) => s + r.amountExpected, 0);
  if (expected <= 0) return 1;
  const paid = counted.reduce((s, r) => s + r.amountPaid, 0);
  return clamp01(paid / expected);
}

export function computeFinancialHealth(
  summary: ScoreSummaryInput,
  records: ScoreRecordInput[],
  now: Date,
  rawWeights: Record<HealthFactorKey, number> = HEALTH_WEIGHTS,
): FinancialHealth {
  // Per-condominium weights are relative importances → normalize to sum 100 so
  // the score stays 0–100 and the reported per-factor weights still add up.
  const W = normalizeWeights(rawWeights);

  const hasData =
    records.length > 0 ||
    summary.monthsPaid + summary.monthsUnpaid > 0 ||
    summary.balance !== 0;

  // Factor 1 — punctuality (count). No counted months ⇒ neutral 1.0 (no late
  // payment has occurred), so a brand-new resident is not penalised.
  const onTime = onTimeRatio(records) ?? 1;

  // Factor 2 — historical collection rate (amount paid vs expected).
  const collectionRate = collectionRateOf(records);

  // Factor 3 — months current. Each unpaid month erodes the factor linearly.
  const monthsCurrent = clamp01(1 - summary.monthsUnpaid / UNPAID_FLOOR);

  // Factor 4 — delinquency age. How long the oldest unpaid month has been
  // overdue; bottoms out at a year.
  const ageMonths = oldestUnpaidAge(records, now);
  const delinquencyAge = clamp01(1 - ageMonths / DELINQUENCY_AGE_FLOOR);

  // Factor 5 — outstanding balance. AGREEMENT (convenio) net is removed from the
  // scoring balance so a negotiated plan reads differently from raw delinquency
  // (RP-030; the DISPLAYED balance/KPI is untouched). Zero/credit is perfect; a
  // debt (positive balance) is scored against the larger of the expected total
  // or the debt itself so the ratio never exceeds 1 and a tiny base cannot
  // overstate health.
  const scoringBalance = summary.balance - agreementNet(records);
  const balanceFactor =
    scoringBalance <= 0
      ? 1
      : clamp01(
          1 - scoringBalance / Math.max(summary.totalExpected, scoringBalance, 1),
        );

  // Factor 6 — recurrence (chronicity). Problem months in the recent window.
  const problems = recentProblemCount(records);
  const recurrence = clamp01(1 - problems / RECURRENCE_FLOOR);

  // Factor 7 — trend (direction). Only a worsening trend costs points; improving
  // or stable keeps full credit (a perfect, stable resident is never penalised).
  const delta = trendDelta(records);
  const trend = clamp01(1 + Math.min(0, delta));

  const points: Record<HealthFactorKey, number> = {
    onTime: onTime * W.onTime,
    collectionRate: collectionRate * W.collectionRate,
    monthsCurrent: monthsCurrent * W.monthsCurrent,
    delinquencyAge: delinquencyAge * W.delinquencyAge,
    balance: balanceFactor * W.balance,
    recurrence: recurrence * W.recurrence,
    trend: trend * W.trend,
  };

  const score = Math.round(
    Object.values(points).reduce((sum, p) => sum + p, 0),
  );

  // 2-decimal precision (RP-028): contributions reconcile with the score and the
  // breakdown is exact. rawValue carries the real objective input (the balance
  // raw stays the resident's actual debt — the agreement leniency lives in the
  // contribution, not in the displayed number).
  const factors: HealthFactor[] = [
    { key: "onTime", weight: round2(W.onTime), contribution: round2(points.onTime), rawValue: round2(onTime * 100), unit: "percent" },
    { key: "collectionRate", weight: round2(W.collectionRate), contribution: round2(points.collectionRate), rawValue: round2(collectionRate * 100), unit: "percent" },
    { key: "monthsCurrent", weight: round2(W.monthsCurrent), contribution: round2(points.monthsCurrent), rawValue: summary.monthsUnpaid, unit: "months" },
    { key: "delinquencyAge", weight: round2(W.delinquencyAge), contribution: round2(points.delinquencyAge), rawValue: ageMonths, unit: "months" },
    { key: "balance", weight: round2(W.balance), contribution: round2(points.balance), rawValue: round2(summary.balance), unit: "currency" },
    { key: "recurrence", weight: round2(W.recurrence), contribution: round2(points.recurrence), rawValue: problems, unit: "months" },
    { key: "trend", weight: round2(W.trend), contribution: round2(points.trend), rawValue: round2(delta * 100), unit: "signedPercent" },
  ];

  return { score, band: bandFor(score), hasData, factors };
}

// Derives a per-month score history (no storage) by recomputing the score "as of"
// each of the last `months` calendar months ending at `now`, using only the
// records up to that month. The as-of summary is built from the records
// themselves (balance = expected − paid, positive = debt). Months with no records
// yet are skipped. Deterministic given `now`.
export function buildScoreHistory(
  records: ScoreRecordInput[],
  months: number,
  now: Date,
  rawWeights: Record<HealthFactorKey, number> = HEALTH_WEIGHTS,
): ScoreHistoryPoint[] {
  const points: ScoreHistoryPoint[] = [];
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth(); // 0-based month
  const span = Math.max(1, Math.floor(months));

  for (let i = span - 1; i >= 0; i--) {
    const idx = nowIndex - i;
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1; // 1-based
    const periodKey = year * 12 + month;

    const upTo = records.filter((r) => r.year * 12 + r.month <= periodKey);
    if (upTo.length === 0) continue;

    const totalExpected = upTo.reduce((s, r) => s + r.amountExpected, 0);
    const totalPaid = upTo.reduce((s, r) => s + r.amountPaid, 0);
    const monthsPaid = upTo.filter(
      (r) => norm(r.status) === ON_TIME || norm(r.status) === LATE,
    ).length;
    const monthsUnpaid = upTo.filter(
      (r) => norm(r.status) === UNPAID || norm(r.status) === "PENDING",
    ).length;
    const summary: ScoreSummaryInput = {
      totalPaid,
      totalExpected,
      monthsPaid,
      monthsUnpaid,
      balance: totalExpected - totalPaid,
    };
    // As-of date = end of that month (UTC), for delinquency-age relative to it.
    const asOf = new Date(Date.UTC(year, month, 0));
    const health = computeFinancialHealth(summary, upTo, asOf, rawWeights);
    points.push({ year, month, score: health.score, band: health.band });
  }

  return points;
}
