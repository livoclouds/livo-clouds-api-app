/**
 * Single rounding authority for monetary amounts (ENGINE-054).
 *
 * Every amount that crosses a persistence or comparison boundary must be
 * rounded through this module so the whole engine shares one policy:
 * half-away-from-zero at 2 decimals, computed in integer-cent space.
 *
 * Plain `Math.round` rounds negative halves toward +Infinity
 * (Math.round(-100.5) === -100), which would make -1.005 and 1.005 round
 * asymmetrically; the sign-symmetric form below avoids that.
 */

/**
 * Integer cents from a float amount, half-away-from-zero.
 * Non-finite input (NaN/Infinity) returns NaN so parse failures stay visible.
 */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  if (value === 0) return 0;
  // Snap to 15 significant digits before rounding: 1.005 * 100 is stored as
  // 100.49999999999999 in IEEE-754, which would round down; the snap restores
  // the decimal value (100.5) the user actually wrote.
  const scaled = Number((Math.abs(value) * 100).toPrecision(15));
  return Math.sign(value) * Math.round(scaled);
}

/** Float amount from integer cents. NaN passes through. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Round an amount to 2 decimals (half away from zero).
 * NaN/Infinity pass through as NaN — never coerced to 0.
 */
export function round2(value: number): number {
  return fromCents(toCents(value));
}

/**
 * Sum amounts in integer-cent space and return a float amount.
 * null/undefined entries count as 0; a non-finite entry poisons the
 * sum to NaN (deliberate — silent drops hide parse corruption).
 */
export function sumAmounts(
  values: ReadonlyArray<number | null | undefined>,
): number {
  let cents = 0;
  for (const value of values) {
    if (value == null) continue;
    cents += toCents(value);
  }
  return fromCents(cents);
}
