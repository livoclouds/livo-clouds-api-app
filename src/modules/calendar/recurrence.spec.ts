import {
  MAX_OCCURRENCES_PER_EVENT,
  RecurrenceValidationError,
  computeRecurrenceEnd,
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

  it('keeps a multi-day occurrence that starts before the window but overlaps it (CAL-041)', () => {
    // 3-day occurrences, weekly. The first occurrence runs 06-01 → 06-04.
    const event = {
      id: 'evt-multiday',
      startDate: new Date('2026-06-01T10:00:00.000Z'),
      endDate: new Date('2026-06-04T10:00:00.000Z'), // 3-day duration
      recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
    };
    // Window starts AFTER the occurrence start but BEFORE its end → overlap only.
    const result = expandRecurrence(
      event,
      new Date('2026-06-02T00:00:00.000Z'),
      new Date('2026-06-03T00:00:00.000Z'),
    );
    // Start-in-range semantics would drop it; overlap semantics keep it.
    expect(result).toHaveLength(1);
    expect(result[0].occurrenceStart.toISOString()).toBe('2026-06-01T10:00:00.000Z');
  });

  it('excludes an occurrence that ends exactly at or before the window start (CAL-041)', () => {
    const event = {
      id: 'evt-edge',
      startDate: new Date('2026-06-01T10:00:00.000Z'),
      endDate: new Date('2026-06-01T12:00:00.000Z'), // 2-hour duration
      recurrenceRule: 'FREQ=DAILY;COUNT=10',
    };
    // Window opens at 13:00 on 06-01 (after the 06-01 occurrence ends at 12:00)
    // and closes at 11:00 on 06-02 (the 06-02 occurrence runs 10:00–12:00).
    const result = expandRecurrence(
      event,
      new Date('2026-06-01T13:00:00.000Z'),
      new Date('2026-06-02T11:00:00.000Z'),
    );
    // The ended 06-01 occurrence is excluded; only the overlapping 06-02 one remains.
    expect(result).toHaveLength(1);
    expect(result[0].occurrenceStart.toISOString()).toBe('2026-06-02T10:00:00.000Z');
  });
});

describe('computeRecurrenceEnd (CAL-040)', () => {
  const END = new Date(START.getTime() + ONE_HOUR); // 1-hour event

  it('returns the last-occurrence end for a COUNT rule', () => {
    // Weekly × 4 from 06-01 → last occurrence starts 06-22, ends +1h.
    const end = computeRecurrenceEnd('FREQ=WEEKLY;COUNT=4', START, END);
    expect(end?.toISOString()).toBe('2026-06-22T11:00:00.000Z');
  });

  it('returns the last-occurrence end for an UNTIL rule', () => {
    // Daily until 06-07 23:59:59 → last occurrence 06-07T10:00, ends +1h.
    const end = computeRecurrenceEnd('FREQ=DAILY;UNTIL=20260607T235959Z', START, END);
    expect(end?.toISOString()).toBe('2026-06-07T11:00:00.000Z');
  });

  it('adds the full multi-day duration to the last occurrence start', () => {
    const longEnd = new Date(START.getTime() + 3 * 24 * ONE_HOUR); // 3-day event
    const end = computeRecurrenceEnd('FREQ=WEEKLY;COUNT=2', START, longEnd);
    // Last start 06-08T10:00 + 3 days → 06-11T10:00.
    expect(end?.toISOString()).toBe('2026-06-11T10:00:00.000Z');
  });

  it('returns null for an unbounded rule (treated as open / never expires)', () => {
    expect(computeRecurrenceEnd('FREQ=WEEKLY', START, END)).toBeNull();
  });

  it('stays cheap on a validated, bounded UNTIL rule', () => {
    // computeRecurrenceEnd is only ever called on rules that already passed
    // validateRecurrenceRule (≤ MAX_OCCURRENCES_PER_EVENT). A bounded UNTIL span
    // resolves its last occurrence without a heavy scan.
    const t0 = Date.now();
    const end = computeRecurrenceEnd('FREQ=DAILY;UNTIL=20270601T235959Z', START, END);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(end?.toISOString()).toBe('2027-06-01T11:00:00.000Z');
  });
});
