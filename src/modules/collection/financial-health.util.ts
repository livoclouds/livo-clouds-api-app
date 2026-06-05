// Explainable financial-health score for the resident 360 profile (Fase 3).
//
// This is intentionally NOT a black box: it is a deterministic, documented
// weighting of strictly objective inputs, and it returns the raw value behind
// every factor so the UI can always show *why* the score is what it is. It makes
// no subjective judgement about the person — only about the account.
//
// Moved server-side in Fase 3 (the web no longer computes it) and expanded from
// 3 to 7 factors. Pure + deterministic: `now` is injected so it is testable.

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

// Documented weights — sum to 100, tunable. (Future: per-condominium config.)
export const HEALTH_WEIGHTS: Record<HealthFactorKey, number> = {
  onTime: 22,
  collectionRate: 16,
  monthsCurrent: 14,
  delinquencyAge: 14,
  balance: 10,
  recurrence: 12,
  trend: 12,
};

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
// PENDING/ADJUSTMENT/EXTRAORDINARY/AGREEMENT are excluded from punctuality — not
// yet due or not a punctuality signal — so an agreement never drags the ratio.
const COUNTED = new Set([ON_TIME, LATE, PARTIAL, UNPAID]);
const PROBLEM = new Set([LATE, PARTIAL, UNPAID]);

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
// expected) — internally consistent with the derived history.
function collectionRateOf(records: ScoreRecordInput[]): number {
  const expected = records.reduce((s, r) => s + r.amountExpected, 0);
  if (expected <= 0) return 1;
  const paid = records.reduce((s, r) => s + r.amountPaid, 0);
  return clamp01(paid / expected);
}

export function computeFinancialHealth(
  summary: ScoreSummaryInput,
  records: ScoreRecordInput[],
  now: Date,
): FinancialHealth {
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

  // Factor 5 — outstanding balance. Zero/credit is perfect; a debt (positive
  // balance) is scored against the larger of the expected total or the debt
  // itself so the ratio never exceeds 1 and a tiny base cannot overstate health.
  const balanceFactor =
    summary.balance <= 0
      ? 1
      : clamp01(
          1 - summary.balance / Math.max(summary.totalExpected, summary.balance, 1),
        );

  // Factor 6 — recurrence (chronicity). Problem months in the recent window.
  const problems = recentProblemCount(records);
  const recurrence = clamp01(1 - problems / RECURRENCE_FLOOR);

  // Factor 7 — trend (direction). Only a worsening trend costs points; improving
  // or stable keeps full credit (a perfect, stable resident is never penalised).
  const delta = trendDelta(records);
  const trend = clamp01(1 + Math.min(0, delta));

  const points: Record<HealthFactorKey, number> = {
    onTime: onTime * HEALTH_WEIGHTS.onTime,
    collectionRate: collectionRate * HEALTH_WEIGHTS.collectionRate,
    monthsCurrent: monthsCurrent * HEALTH_WEIGHTS.monthsCurrent,
    delinquencyAge: delinquencyAge * HEALTH_WEIGHTS.delinquencyAge,
    balance: balanceFactor * HEALTH_WEIGHTS.balance,
    recurrence: recurrence * HEALTH_WEIGHTS.recurrence,
    trend: trend * HEALTH_WEIGHTS.trend,
  };

  const score = Math.round(
    Object.values(points).reduce((sum, p) => sum + p, 0),
  );

  const factors: HealthFactor[] = [
    { key: "onTime", weight: HEALTH_WEIGHTS.onTime, contribution: Math.round(points.onTime), rawValue: Math.round(onTime * 100), unit: "percent" },
    { key: "collectionRate", weight: HEALTH_WEIGHTS.collectionRate, contribution: Math.round(points.collectionRate), rawValue: Math.round(collectionRate * 100), unit: "percent" },
    { key: "monthsCurrent", weight: HEALTH_WEIGHTS.monthsCurrent, contribution: Math.round(points.monthsCurrent), rawValue: summary.monthsUnpaid, unit: "months" },
    { key: "delinquencyAge", weight: HEALTH_WEIGHTS.delinquencyAge, contribution: Math.round(points.delinquencyAge), rawValue: ageMonths, unit: "months" },
    { key: "balance", weight: HEALTH_WEIGHTS.balance, contribution: Math.round(points.balance), rawValue: summary.balance, unit: "currency" },
    { key: "recurrence", weight: HEALTH_WEIGHTS.recurrence, contribution: Math.round(points.recurrence), rawValue: problems, unit: "months" },
    { key: "trend", weight: HEALTH_WEIGHTS.trend, contribution: Math.round(points.trend), rawValue: Math.round(delta * 100), unit: "signedPercent" },
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
    const health = computeFinancialHealth(summary, upTo, asOf);
    points.push({ year, month, score: health.score, band: health.band });
  }

  return points;
}
