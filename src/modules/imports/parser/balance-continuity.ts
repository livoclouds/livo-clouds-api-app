import type { ParsedRow } from './types';
import { toCents } from '../../../common/utils/money.util';

/**
 * ENGINE-027 — running-balance continuity validation.
 *
 * A bank export's strongest integrity invariant is that each row's balance
 * equals the previous balance plus the row's net movement:
 *
 *     balance[i] = balance[i-1] + credits[i] - charges[i]
 *
 * Until Phase 3 the balance column was stored but never checked, so misparsed
 * amounts and dropped rows passed silently. This validator runs over the FULL
 * parsed row set (both preview and confirm — same function, same input, so
 * the two paths stay in lockstep), reports breaks as warnings, and confirm
 * refuses files whose break ratio exceeds BALANCE_DISCONTINUITY_THRESHOLD.
 */

export interface BalanceDiscontinuity {
  /** Index into the CHRONOLOGICALLY ordered sequence, not the file order. */
  rowIndex: number;
  expectedBalance: number;
  actualBalance: number;
  deltaCents: number;
}

export interface BalanceContinuityReport {
  /** false → not enough usable rows / no usable balance column. */
  checked: boolean;
  direction: 'oldest-first' | 'newest-first' | 'unknown';
  totalComparisons: number;
  discontinuities: number;
  /** discontinuities / totalComparisons (0 when nothing was comparable). */
  discontinuityRatio: number;
  sample: BalanceDiscontinuity[];
}

/** Confirm refuses when more than 10% of consecutive pairs break continuity. */
export const BALANCE_DISCONTINUITY_THRESHOLD = 0.1;

/** Breaks smaller than one cent are bank-side display rounding, not breaks. */
const SLACK_CENTS = 1;

const SAMPLE_CAP = 10;

interface UsableRow {
  balanceCents: number;
  creditsCents: number;
  chargesCents: number;
}

function isUsable(row: ParsedRow): boolean {
  return (
    (row.parseIssues?.length ?? 0) === 0 &&
    Number.isFinite(row.balance) &&
    Number.isFinite(row.credits) &&
    Number.isFinite(row.charges) &&
    !Number.isNaN(new Date(row.date).getTime())
  );
}

function countBreaks(rows: UsableRow[]): {
  comparisons: number;
  breaks: BalanceDiscontinuity[];
} {
  const breaks: BalanceDiscontinuity[] = [];
  let comparisons = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    comparisons++;
    const expectedCents =
      prev.balanceCents + cur.creditsCents - cur.chargesCents;
    const deltaCents = cur.balanceCents - expectedCents;
    if (Math.abs(deltaCents) > SLACK_CENTS) {
      breaks.push({
        rowIndex: i,
        expectedBalance: expectedCents / 100,
        actualBalance: cur.balanceCents / 100,
        deltaCents,
      });
    }
  }
  return { comparisons, breaks };
}

/**
 * Validates running-balance continuity over the parsed rows.
 *
 * Direction handling: banks export either oldest-first or newest-first. Rather
 * than trusting date monotonicity (intra-day rows share a date; equal dates
 * resolve by file order — the computeFinalBalance convention), both directions
 * are evaluated and the one with FEWER breaks wins: a genuinely continuous
 * file scores 0 in its true direction and ~N in the reverse.
 */
export function validateBalanceContinuity(
  rows: ParsedRow[],
): BalanceContinuityReport {
  const usable: UsableRow[] = rows.filter(isUsable).map((row) => ({
    balanceCents: toCents(row.balance),
    creditsCents: toCents(row.credits),
    chargesCents: toCents(row.charges),
  }));

  // A file whose balance column is entirely 0 carries no balance information
  // (parsers emit 0 when the column is missing) — nothing to validate.
  const hasBalanceSignal = usable.some((r) => r.balanceCents !== 0);

  if (usable.length < 2 || !hasBalanceSignal) {
    return {
      checked: false,
      direction: 'unknown',
      totalComparisons: 0,
      discontinuities: 0,
      discontinuityRatio: 0,
      sample: [],
    };
  }

  const forward = countBreaks(usable);
  const backward = countBreaks([...usable].reverse());

  const forwardWins = forward.breaks.length <= backward.breaks.length;
  const winner = forwardWins ? forward : backward;
  const direction: BalanceContinuityReport['direction'] = forwardWins
    ? 'oldest-first'
    : 'newest-first';

  return {
    checked: true,
    direction,
    totalComparisons: winner.comparisons,
    discontinuities: winner.breaks.length,
    discontinuityRatio:
      winner.comparisons === 0 ? 0 : winner.breaks.length / winner.comparisons,
    sample: winner.breaks.slice(0, SAMPLE_CAP),
  };
}
