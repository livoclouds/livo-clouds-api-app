// Official Mexican public holidays (días de descanso obligatorio) under art. 74
// of the Ley Federal del Trabajo. Used to count business days for the LFPDPPP
// ARCO legal response window. Evergreen: dates are computed per year (fixed
// dates + the "nth Monday" rules) so there is no annual data to maintain. Pure
// and UTC-deterministic, matching computeArcoDueDate.

// Irregular one-off holidays that don't follow a yearly rule — e.g. the
// transmission of federal executive power (art. 74 §VI) or a decreed federal
// election day. Add ISO `YYYY-MM-DD` (UTC) keys here as they are published; the
// matcher treats them as non-working days without changing the computed logic.
export const MX_HOLIDAY_OVERRIDES: readonly string[] = [
  '2024-10-01', // transmission of federal executive power (2024)
];

// Date of the `n`-th `weekday` of `month` in `year` (UTC).
// weekday: 0 = Sunday … 6 = Saturday. month: 0 = January … 11 = December.
// `n` is 1-based (1 = first occurrence).
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number,
): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

function isoKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const cache = new Map<number, Set<string>>();

// The set of official MX holiday ISO keys (YYYY-MM-DD, UTC) for a given year.
// Memoized — deterministic, so the cache never needs invalidation.
export function mexicanHolidaysForYear(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const keys = new Set<string>();
  // Fixed-date holidays.
  const fixed: ReadonlyArray<readonly [number, number]> = [
    [0, 1], // Jan 1 — New Year
    [4, 1], // May 1 — Labour Day
    [8, 16], // Sep 16 — Independence Day
    [11, 25], // Dec 25 — Christmas
  ];
  for (const [month, day] of fixed) {
    keys.add(isoKey(new Date(Date.UTC(year, month, day))));
  }
  // "nth Monday" holidays (art. 74, days of national commemoration).
  keys.add(isoKey(nthWeekdayOfMonth(year, 1, 1, 1))); // 1st Monday of February
  keys.add(isoKey(nthWeekdayOfMonth(year, 2, 1, 3))); // 3rd Monday of March
  keys.add(isoKey(nthWeekdayOfMonth(year, 10, 1, 3))); // 3rd Monday of November
  // Irregular one-offs decreed for specific years.
  for (const iso of MX_HOLIDAY_OVERRIDES) {
    if (iso.startsWith(`${year}-`)) keys.add(iso);
  }

  cache.set(year, keys);
  return keys;
}

// True when `date` (interpreted in UTC) is an official Mexican public holiday.
export function isMexicanHoliday(date: Date): boolean {
  return mexicanHolidaysForYear(date.getUTCFullYear()).has(isoKey(date));
}
