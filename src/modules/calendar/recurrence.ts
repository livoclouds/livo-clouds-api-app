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
  const occurrences = rule.between(fromDate, toDate, true);

  return occurrences.map((occurrenceStart) => {
    const occurrenceEnd = new Date(occurrenceStart.getTime() + duration);
    return {
      source: event,
      occurrenceId: `${event.id}::${occurrenceStart.toISOString()}`,
      occurrenceStart,
      occurrenceEnd,
    };
  });
}
