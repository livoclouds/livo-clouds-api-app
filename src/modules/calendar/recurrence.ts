import { Frequency, RRule } from 'rrule';

export const MAX_OCCURRENCES_PER_EVENT = 366;
export const MAX_TOTAL_OCCURRENCES = 2000;

export type RecurrenceErrorCode =
  | 'recurrenceInvalid'
  | 'recurrenceUnbounded'
  | 'recurrenceTooMany';

export class RecurrenceValidationError extends Error {
  constructor(
    public readonly code: RecurrenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RecurrenceValidationError';
  }
}

const SUB_DAILY_FREQUENCIES = new Set<Frequency>([
  Frequency.HOURLY,
  Frequency.MINUTELY,
  Frequency.SECONDLY,
]);

function buildRule(rrule: string, dtstart: Date): RRule {
  const options = RRule.parseString(rrule);
  return new RRule({ ...options, dtstart });
}

export function validateRecurrenceRule(rrule: string, startDate: Date): void {
  let rule: RRule;
  try {
    rule = buildRule(rrule, startDate);
  } catch {
    throw new RecurrenceValidationError(
      'recurrenceInvalid',
      'Recurrence pattern could not be parsed.',
    );
  }

  const { freq, until, count } = rule.options;

  if (SUB_DAILY_FREQUENCIES.has(freq)) {
    throw new RecurrenceValidationError(
      'recurrenceInvalid',
      'Sub-daily recurrence frequencies are not supported.',
    );
  }

  if (until == null && count == null) {
    throw new RecurrenceValidationError(
      'recurrenceUnbounded',
      'Recurrence must end on a date (UNTIL) or after a number of occurrences (COUNT).',
    );
  }

  if (count != null && count > MAX_OCCURRENCES_PER_EVENT) {
    throw new RecurrenceValidationError(
      'recurrenceTooMany',
      `Recurrence COUNT exceeds the per-event cap (${MAX_OCCURRENCES_PER_EVENT}).`,
    );
  }

  if (until != null) {
    // CAL-013: count occurrences via an early-exit iterator instead of
    // materializing the whole UNTIL span. `rule.between(startDate, until, true)`
    // would allocate every occurrence up front — an adversarial rule such as
    // `FREQ=DAILY;UNTIL=99991231T235959Z` (well under the 500-char cap) forces
    // ~2.9M Date allocations and blocks the event loop before the length check.
    // `all(iterator)` stops as soon as the callback returns false, so we never
    // collect more than MAX_OCCURRENCES_PER_EVENT + 1 dates regardless of span.
    let occurrences = 0;
    rule.all((_date, index) => {
      occurrences = index + 1;
      return index < MAX_OCCURRENCES_PER_EVENT;
    });
    if (occurrences > MAX_OCCURRENCES_PER_EVENT) {
      throw new RecurrenceValidationError(
        'recurrenceTooMany',
        `Recurrence would generate more than ${MAX_OCCURRENCES_PER_EVENT} occurrences in the bounded range.`,
      );
    }
  }
}

export interface ExpandableEvent {
  id: string;
  startDate: Date;
  endDate: Date;
  recurrenceRule: string | null;
}

export interface ExpandedOccurrence<T extends ExpandableEvent> {
  source: T;
  occurrenceId: string;
  occurrenceStart: Date;
  occurrenceEnd: Date;
}

/**
 * Expand a recurring event into the occurrences that intersect [fromDate, toDate].
 *
 * Contract — recurrence is anchored at **fixed UTC instants** (CAL-042). The
 * rrule engine expands from `event.startDate` as an absolute UTC timestamp and
 * applies no wall-clock/DST correction: a series at 18:00 in a DST-observing
 * zone shifts to 17:00 or 19:00 local after a transition. This is intentional
 * for the primary market (no DST); timezone-aware expansion is deferred.
 *
 * Window semantics — occurrences are kept when they **overlap** the window
 * (`occurrenceStart < toDate && occurrenceEnd > fromDate`), matching the
 * single-event filter in `calendar.service.ts` (CAL-041). The rrule scan starts
 * `duration` before `fromDate` so a multi-day occurrence that began before the
 * window but still overlaps it is not dropped.
 */
/**
 * CAL-040: compute the **end instant of the last occurrence** of a recurring
 * series, so it can be denormalized into the indexed `recurrenceEndsAt` column
 * and the recurring-parent read can be bounded at the DB level (instead of
 * scanning every recurring parent over a tenant's lifetime).
 *
 * Returns `null` for an unparseable or truly unbounded rule (validation rejects
 * those on write, so a NULL here means "treat as open / never expires" — the
 * read keeps such rows rather than risk dropping a live series).
 *
 * Precondition — the caller must have already run `validateRecurrenceRule`
 * (the service does, via `assertRecurrenceAllowed`, on every write; the backfill
 * only sees rules that passed it). That bounds every rule to ≤
 * MAX_OCCURRENCES_PER_EVENT occurrences, so the COUNT `rule.all()` and the UNTIL
 * `rule.before(until, true)` both stay cheap. An adversarial unbounded span
 * (e.g. `FREQ=DAILY;UNTIL=99991231T235959Z`) is rejected upstream and never
 * reaches here — do NOT call this on un-validated input.
 */
export function computeRecurrenceEnd(
  rrule: string,
  startDate: Date,
  endDate: Date,
): Date | null {
  let rule: RRule;
  try {
    rule = buildRule(rrule, startDate);
  } catch {
    return null;
  }

  const { until, count } = rule.options;

  let lastStart: Date | null = null;
  if (count != null) {
    // COUNT is validated ≤ MAX_OCCURRENCES_PER_EVENT, so this is bounded.
    const all = rule.all();
    lastStart = all.length > 0 ? all[all.length - 1] : null;
  } else if (until != null) {
    // Last occurrence on/before UNTIL, computed without expanding the full span.
    lastStart = rule.before(until, true);
  } else {
    // Truly unbounded (rejected on write) → leave open.
    return null;
  }

  if (lastStart == null) return null;
  const duration = Math.max(endDate.getTime() - startDate.getTime(), 0);
  return new Date(lastStart.getTime() + duration);
}

export function expandRecurrence<T extends ExpandableEvent>(
  event: T,
  fromDate: Date,
  toDate: Date,
): ExpandedOccurrence<T>[] {
  if (event.recurrenceRule == null) {
    return [];
  }

  const duration = event.endDate.getTime() - event.startDate.getTime();
  const rule = buildRule(event.recurrenceRule, event.startDate);
  // CAL-041: widen the scan start by the event duration so an occurrence whose
  // start precedes the window but whose end falls inside it is captured, then
  // post-filter by true overlap (rule.between is start-in-range only).
  const scanFrom = new Date(fromDate.getTime() - Math.max(duration, 0));
  const occurrences = rule.between(scanFrom, toDate, true);

  return occurrences
    .map((occurrenceStart) => {
      const occurrenceEnd = new Date(occurrenceStart.getTime() + duration);
      return {
        source: event,
        occurrenceId: `${event.id}::${occurrenceStart.toISOString()}`,
        occurrenceStart,
        occurrenceEnd,
      };
    })
    .filter(
      (o) =>
        o.occurrenceStart.getTime() < toDate.getTime() &&
        o.occurrenceEnd.getTime() > fromDate.getTime(),
    );
}
