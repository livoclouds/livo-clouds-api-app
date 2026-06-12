import {
  MAX_OCCURRENCES_PER_EVENT,
  RecurrenceValidationError,
  expandRecurrence,
  validateRecurrenceRule,
} from './recurrence';

const START = new Date('2026-06-01T10:00:00.000Z');
const ONE_HOUR = 60 * 60 * 1000;

describe('validateRecurrenceRule', () => {
  it('accepts a daily RRULE with UNTIL', () => {
    expect(() =>
      validateRecurrenceRule('FREQ=DAILY;UNTIL=20260607T235959Z', START),
    ).not.toThrow();
  });

  it('accepts a weekly RRULE with COUNT', () => {
    expect(() =>
      validateRecurrenceRule('FREQ=WEEKLY;COUNT=10', START),
    ).not.toThrow();
  });

  it.each(['SECONDLY', 'MINUTELY', 'HOURLY'])(
    'rejects sub-daily frequency %s with code recurrenceInvalid',
    (freq) => {
      try {
        validateRecurrenceRule(`FREQ=${freq};COUNT=5`, START);
        throw new Error('did not throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RecurrenceValidationError);
        expect((err as RecurrenceValidationError).code).toBe('recurrenceInvalid');
      }
    },
  );

  it('rejects an unbounded RRULE (no UNTIL or COUNT) with code recurrenceUnbounded', () => {
    try {
      validateRecurrenceRule('FREQ=DAILY', START);
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RecurrenceValidationError);
      expect((err as RecurrenceValidationError).code).toBe('recurrenceUnbounded');
    }
  });

  it('rejects an RRULE whose COUNT exceeds MAX_OCCURRENCES_PER_EVENT', () => {
    try {
      validateRecurrenceRule(
        `FREQ=DAILY;COUNT=${MAX_OCCURRENCES_PER_EVENT + 1}`,
        START,
      );
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RecurrenceValidationError);
      expect((err as RecurrenceValidationError).code).toBe('recurrenceTooMany');
    }
  });

  it('rejects an RRULE whose UNTIL span exceeds MAX_OCCURRENCES_PER_EVENT', () => {
    try {
      // ~2 years of daily occurrences (~730) — well over the 366 cap.
      validateRecurrenceRule('FREQ=DAILY;UNTIL=20280601T235959Z', START);
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RecurrenceValidationError);
      expect((err as RecurrenceValidationError).code).toBe('recurrenceTooMany');
    }
  });

  it('rejects an adversarial far-future UNTIL in under 50ms (CAL-013, no full-span materialization)', () => {
    // FREQ=DAILY;UNTIL=99991231T235959Z fits the 500-char cap but would allocate
    // ~2.9M Date objects under the old rule.between() path, blocking the event loop.
    // The early-exit iterator must reject it near-instantly.
    const startedAt = performance.now();
    try {
      validateRecurrenceRule('FREQ=DAILY;UNTIL=99991231T235959Z', START);
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RecurrenceValidationError);
      expect((err as RecurrenceValidationError).code).toBe('recurrenceTooMany');
    }
    const elapsedMs = performance.now() - startedAt;
    expect(elapsedMs).toBeLessThan(50);
  });

  it('accepts a daily UNTIL rule exactly at the per-event cap', () => {
    // 366 daily occurrences starting 2026-06-01 → last day 2027-06-01 (inclusive),
    // 2026 being a non-leap year. Stays within MAX_OCCURRENCES_PER_EVENT.
    expect(() =>
      validateRecurrenceRule('FREQ=DAILY;UNTIL=20270601T235959Z', START),
    ).not.toThrow();
  });

  it('rejects an unparseable RRULE with code recurrenceInvalid', () => {
    try {
      validateRecurrenceRule('this-is-not-an-rrule', START);
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RecurrenceValidationError);
      expect((err as RecurrenceValidationError).code).toBe('recurrenceInvalid');
    }
  });
});

describe('expandRecurrence', () => {
  const baseEvent = {
    id: 'evt-parent',
    startDate: START,
    endDate: new Date(START.getTime() + ONE_HOUR),
  };

  it('returns [] for events with no recurrenceRule', () => {
    const result = expandRecurrence(
      { ...baseEvent, recurrenceRule: null },
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-12-31T23:59:59.999Z'),
    );
    expect(result).toEqual([]);
  });

  it('expands a daily RRULE over a 7-day window into 7 occurrences with synthetic IDs', () => {
    const result = expandRecurrence(
      { ...baseEvent, recurrenceRule: 'FREQ=DAILY;COUNT=14' },
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-07T23:59:59.999Z'),
    );
    expect(result).toHaveLength(7);
    expect(result[0].occurrenceId).toBe(
      `evt-parent::${result[0].occurrenceStart.toISOString()}`,
    );
    expect(result.every((occ) => occ.occurrenceId.startsWith('evt-parent::'))).toBe(true);
  });

  it('expands a weekly RRULE over a 30-day window into 4-5 occurrences', () => {
    const result = expandRecurrence(
      { ...baseEvent, recurrenceRule: 'FREQ=WEEKLY;COUNT=10' },
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-30T23:59:59.999Z'),
    );
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('expands a monthly RRULE over a 90-day window into 3 occurrences', () => {
    const result = expandRecurrence(
      { ...baseEvent, recurrenceRule: 'FREQ=MONTHLY;COUNT=12' },
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-08-31T23:59:59.999Z'),
    );
    expect(result).toHaveLength(3);
  });

  it('preserves the parent event duration on every occurrence', () => {
    const event = {
      id: 'evt-3h',
      startDate: START,
      endDate: new Date(START.getTime() + 3 * ONE_HOUR),
      recurrenceRule: 'FREQ=DAILY;COUNT=3',
    };
    const result = expandRecurrence(
      event,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-04T00:00:00.000Z'),
    );
    expect(result).toHaveLength(3);
    for (const occ of result) {
      expect(occ.occurrenceEnd.getTime() - occ.occurrenceStart.getTime()).toBe(
        3 * ONE_HOUR,
      );
    }
  });

  it('truncates expansion at UNTIL', () => {
    const result = expandRecurrence(
      { ...baseEvent, recurrenceRule: 'FREQ=DAILY;UNTIL=20260603T235959Z' },
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-30T23:59:59.999Z'),
    );
    expect(result).toHaveLength(3);
    expect(
      result.every(
        (occ) => occ.occurrenceStart <= new Date('2026-06-03T23:59:59.999Z'),
      ),
    ).toBe(true);
  });

  it('returns [] when the query window is before the recurrence start', () => {
    const result = expandRecurrence(
      { ...baseEvent, recurrenceRule: 'FREQ=DAILY;COUNT=5' },
      new Date('2025-01-01T00:00:00.000Z'),
      new Date('2025-12-31T23:59:59.999Z'),
    );
    expect(result).toEqual([]);
  });
});
