import {
  matchTerraceBooking,
  TERRACE_DATE_WINDOW_DAYS,
  type TerraceCandidate,
  type TerraceMatchInput,
} from './terrace-booking-matcher';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysFromEvent(eventDate: Date, daysBeforeEvent: number): Date {
  const d = new Date(eventDate);
  d.setUTCDate(d.getUTCDate() - daysBeforeEvent);
  return d;
}

const EVENT_DATE = new Date('2026-06-15T12:00:00Z');

function candidate(overrides: Partial<TerraceCandidate> = {}): TerraceCandidate {
  return {
    id: 'event-001',
    residentId: 'resident-001',
    unitNumber: '5',
    startDate: EVENT_DATE,
    terraceRentalAmount: 1500,
    // Phase 3: deposit distinct from rental (and from the 1000 used by the
    // "amount does not match" test) and not yet received; booking unclaimed by
    // default so existing rental-match tests keep their AUTO outcome.
    securityDepositAmount: 750,
    securityDepositStatus: 'PENDING',
    claimed: false,
    customKeywords: [],
    ...overrides,
  };
}

function input(overrides: Partial<TerraceMatchInput> = {}): TerraceMatchInput {
  return {
    amount: 1500,
    transactionDate: daysFromEvent(EVENT_DATE, 5), // 5 days before event
    description: 'Reservacion terraza junio',
    detectedResidentId: 'resident-001',
    detectedUnitNumber: '5',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('matchTerraceBooking', () => {
  // ── No candidates ───────────────────────────────────────────────────────────

  it('returns null when candidate list is empty', () => {
    expect(matchTerraceBooking(input(), [])).toBeNull();
  });

  // ── Amount filtering ────────────────────────────────────────────────────────

  it('returns null when amount does not match', () => {
    const result = matchTerraceBooking(input({ amount: 1000 }), [candidate()]);
    expect(result).toBeNull();
  });

  it('returns null when amount is zero even if all other signals match', () => {
    const result = matchTerraceBooking(input({ amount: 0 }), [candidate()]);
    expect(result).toBeNull();
  });

  // ── Date window ─────────────────────────────────────────────────────────────

  it('matches when transaction is on the event day (day 0)', () => {
    const result = matchTerraceBooking(
      input({ transactionDate: EVENT_DATE }),
      [candidate()],
    );
    expect(result).not.toBeNull();
  });

  it('matches when transaction is exactly at the window boundary', () => {
    const result = matchTerraceBooking(
      input({ transactionDate: daysFromEvent(EVENT_DATE, TERRACE_DATE_WINDOW_DAYS) }),
      [candidate()],
    );
    expect(result).not.toBeNull();
  });

  it('returns null when transaction is 1 day outside the window', () => {
    const result = matchTerraceBooking(
      input({ transactionDate: daysFromEvent(EVENT_DATE, TERRACE_DATE_WINDOW_DAYS + 1) }),
      [candidate()],
    );
    expect(result).toBeNull();
  });

  it('returns null when transaction date is after the event', () => {
    const afterEvent = new Date(EVENT_DATE);
    afterEvent.setUTCDate(afterEvent.getUTCDate() + 1);
    const result = matchTerraceBooking(input({ transactionDate: afterEvent }), [candidate()]);
    expect(result).toBeNull();
  });

  // ── Minimum signal requirement ──────────────────────────────────────────────

  it('returns null when amount + date match but no other signals (no resident, unit, or keyword)', () => {
    const result = matchTerraceBooking(
      input({
        description: 'TRANSFERENCIA SPEI',
        detectedResidentId: null,
        detectedUnitNumber: null,
      }),
      [candidate({ residentId: 'resident-001', unitNumber: '5' })],
    );
    expect(result).toBeNull();
  });

  // ── Strong match: resident + unit → AUTO ────────────────────────────────────

  it('produces AUTO with score 0.95 when resident and unit both match', () => {
    const result = matchTerraceBooking(input(), [candidate()]);
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('AUTO');
    expect(result!.confidenceScore).toBe(0.95);
    expect(result!.matchedCalendarEventId).toBe('event-001');
    expect(result!.residentId).toBe('resident-001');
    expect(result!.requiresReviewReason).toBeNull();
    expect(result!.paymentConcept).toBe('AMENITY');
    expect(result!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(result!.matchedAt).toBeInstanceOf(Date);
  });

  // ── Strong match: resident only → AUTO ─────────────────────────────────────

  it('produces AUTO with score 0.90 when only resident matches (no unit detected)', () => {
    const result = matchTerraceBooking(
      input({ detectedUnitNumber: null }),
      [candidate({ unitNumber: '5' })],
    );
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('AUTO');
    expect(result!.confidenceScore).toBe(0.90);
    expect(result!.residentId).toBe('resident-001');
  });

  it('produces AUTO with score 0.90 when resident matches but event has no unit', () => {
    const result = matchTerraceBooking(
      input({ detectedUnitNumber: '5' }),
      [candidate({ unitNumber: null })],
    );
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('AUTO');
    expect(result!.confidenceScore).toBe(0.90);
  });

  // ── Strong match: unit only → AUTO ─────────────────────────────────────────

  it('produces AUTO with score 0.88 when only unit matches (no resident detected)', () => {
    const result = matchTerraceBooking(
      input({ detectedResidentId: null }),
      [candidate()],
    );
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('AUTO');
    expect(result!.confidenceScore).toBe(0.88);
    expect(result!.matchedCalendarEventId).toBe('event-001');
  });

  // ── Keyword only → NEEDS_REVIEW ────────────────────────────────────────────

  it('produces NEEDS_REVIEW LOW_CONFIDENCE for keyword-only match', () => {
    const result = matchTerraceBooking(
      input({
        description: 'reservacion para evento',
        detectedResidentId: null,
        detectedUnitNumber: null,
      }),
      [candidate()],
    );
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
    expect(result!.requiresReviewReason).toBe('LOW_CONFIDENCE');
    expect(result!.confidenceScore).toBe(0.70);
    expect(result!.matchedCalendarEventId).toBe('event-001');
    expect(result!.matchedAt).toBeNull();
  });

  it('keyword matching is accent-insensitive', () => {
    const result = matchTerraceBooking(
      input({
        description: 'Reservación de la terraza',
        detectedResidentId: null,
        detectedUnitNumber: null,
      }),
      [candidate()],
    );
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
  });

  it('recognizes all keyword variants', () => {
    const keywords = ['terraza', 'terrace', 'salon', 'amenidad', 'amenity', 'reserva', 'reservacion', 'reservation', 'evento'];
    for (const kw of keywords) {
      const result = matchTerraceBooking(
        input({ description: `pago ${kw} junio`, detectedResidentId: null, detectedUnitNumber: null }),
        [candidate()],
      );
      expect(result).not.toBeNull();
      expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
    }
  });

  // ── Multiple candidates → TERRACE_AMBIGUOUS ────────────────────────────────

  it('produces TERRACE_AMBIGUOUS when multiple candidates tie at top score', () => {
    const c1 = candidate({ id: 'event-001', residentId: 'resident-001', unitNumber: '5' });
    const c2 = candidate({ id: 'event-002', residentId: 'resident-002', unitNumber: '5', startDate: EVENT_DATE });
    const result = matchTerraceBooking(
      input({ detectedResidentId: null, detectedUnitNumber: '5' }),
      [c1, c2],
    );
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
    expect(result!.requiresReviewReason).toBe('TERRACE_AMBIGUOUS');
    expect(result!.matchedCalendarEventId).toBeNull();
    expect(result!.confidenceScore).toBe(0.60);
    // CAL-037: the tied candidate ids are surfaced for the review UI.
    expect(result!.candidateEventIds.sort()).toEqual(['event-001', 'event-002']);
  });

  it('does not produce TERRACE_AMBIGUOUS when candidates are separated by signal score', () => {
    // c1 has residentId match (score 2); c2 has only keyword (score 1)
    const c1 = candidate({ id: 'event-001', residentId: 'resident-001' });
    const c2 = candidate({ id: 'event-002', residentId: 'resident-999', unitNumber: null });
    const result = matchTerraceBooking(
      input({ detectedResidentId: 'resident-001', detectedUnitNumber: null }),
      [c1, c2],
    );
    // c1 wins because residentId match gives score 2 vs keyword-only score 1 for c2
    expect(result).not.toBeNull();
    expect(result!.requiresReviewReason).not.toBe('TERRACE_AMBIGUOUS');
    expect(result!.matchedCalendarEventId).toBe('event-001');
  });

  // ── Event with no residentId or unitNumber ──────────────────────────────────

  it('falls through to keyword-only match when event has neither residentId nor unitNumber', () => {
    const result = matchTerraceBooking(
      input({ description: 'terraza junio', detectedResidentId: 'resident-001', detectedUnitNumber: '5' }),
      [candidate({ residentId: null, unitNumber: null })],
    );
    // No unit or resident to match against, so only keyword signal fires.
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
    expect(result!.requiresReviewReason).toBe('LOW_CONFIDENCE');
  });

  // ── Unit number normalization ───────────────────────────────────────────────

  it('matches unit numbers case-insensitively', () => {
    const result = matchTerraceBooking(
      input({ detectedUnitNumber: '5A', detectedResidentId: null }),
      [candidate({ unitNumber: '5a', residentId: null })],
    );
    // keyword also present in description ('terraza'), so signal = UNIT + KEYWORD = 3
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('AUTO');
  });

  // ── matchedAt ──────────────────────────────────────────────────────────────

  it('sets matchedAt for AUTO results and null for NEEDS_REVIEW', () => {
    const autoResult = matchTerraceBooking(input(), [candidate()]);
    expect(autoResult!.matchedAt).toBeInstanceOf(Date);

    const reviewResult = matchTerraceBooking(
      input({ description: 'evento', detectedResidentId: null, detectedUnitNumber: null }),
      [candidate()],
    );
    expect(reviewResult!.matchedAt).toBeNull();
  });

  // ── Custom keywords ────────────────────────────────────────────────────────

  it('triggers keyword signal via candidate customKeywords not in the global list', () => {
    const result = matchTerraceBooking(
      input({
        description: 'renta salon fiesta',
        detectedResidentId: null,
        detectedUnitNumber: null,
      }),
      [candidate({ customKeywords: ['fiesta', 'renta salon'] })],
    );
    expect(result).not.toBeNull();
    expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
    expect(result!.requiresReviewReason).toBe('LOW_CONFIDENCE');
  });

  it('does not trigger keyword signal when description has no global or custom keywords', () => {
    const result = matchTerraceBooking(
      input({
        description: 'TRANSFERENCIA SPEI',
        detectedResidentId: null,
        detectedUnitNumber: null,
      }),
      [candidate({ customKeywords: ['fiesta'] })],
    );
    expect(result).toBeNull();
  });

  // ── Phase 5F — Tenant-level global keywords ────────────────────────────────

  describe('global keywords (Phase 5F / KI-004)', () => {
    it('triggers keyword signal via tenant global keywords (description is not in hardcoded list and not in candidate customKeywords)', () => {
      const result = matchTerraceBooking(
        input({
          description: 'pago kiosko junio',
          detectedResidentId: null,
          detectedUnitNumber: null,
          globalKeywords: ['kiosko'],
        }),
        [candidate({ customKeywords: [] })],
      );
      expect(result).not.toBeNull();
      expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
      expect(result!.requiresReviewReason).toBe('LOW_CONFIDENCE');
      expect(result!.confidenceScore).toBe(0.7);
      expect(result!.matchedCalendarEventId).toBe('event-001');
    });

    it('combines a global-keyword signal with a unit signal to reach AUTO 0.88', () => {
      const result = matchTerraceBooking(
        input({
          description: 'pago kiosko casa 5',
          detectedResidentId: null,
          detectedUnitNumber: '5',
          globalKeywords: ['kiosko'],
        }),
        [candidate({ residentId: null, customKeywords: [] })],
      );
      expect(result).not.toBeNull();
      expect(result!.classificationStatus).toBe('AUTO');
      expect(result!.confidenceScore).toBe(0.88);
    });

    it('preserves existing behavior when globalKeywords is empty / undefined', () => {
      const r1 = matchTerraceBooking(input({ globalKeywords: [] }), [candidate()]);
      const r2 = matchTerraceBooking(input(), [candidate()]);
      expect(r1).toEqual({ ...r1, matchedAt: r1!.matchedAt });
      expect(r1!.classificationStatus).toBe('AUTO');
      expect(r1!.confidenceScore).toBe(0.95);
      expect(r2!.classificationStatus).toBe('AUTO');
      expect(r2!.confidenceScore).toBe(0.95);
    });

    it('matches accent-folded global keywords against accented descriptions', () => {
      const result = matchTerraceBooking(
        input({
          description: 'reserva salón social marzo',
          detectedResidentId: null,
          detectedUnitNumber: null,
          globalKeywords: ['salon social'],
        }),
        [candidate({ customKeywords: [] })],
      );
      expect(result).not.toBeNull();
      expect(result!.confidenceScore).toBe(0.7);
      expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
    });

    it('does not double-count when both global keywords and customKeywords match (signal is binary)', () => {
      const both = matchTerraceBooking(
        input({
          description: 'pago club house mayo',
          detectedResidentId: null,
          detectedUnitNumber: null,
          globalKeywords: ['club house'],
        }),
        [candidate({ customKeywords: ['club house'] })],
      );
      const onlyGlobal = matchTerraceBooking(
        input({
          description: 'pago club house mayo',
          detectedResidentId: null,
          detectedUnitNumber: null,
          globalKeywords: ['club house'],
        }),
        [candidate({ customKeywords: [] })],
      );
      expect(both).not.toBeNull();
      expect(onlyGlobal).not.toBeNull();
      expect(both!.confidenceScore).toBe(onlyGlobal!.confidenceScore);
      expect(both!.classificationStatus).toBe(onlyGlobal!.classificationStatus);
    });
  });

  // ── CAL-003: duplicate (claimed booking) ─────────────────────────────────────

  describe('claimed bookings (CAL-003)', () => {
    it('flags a payment for an already-claimed booking as TERRACE_DUPLICATE instead of linking', () => {
      const result = matchTerraceBooking(input(), [candidate({ claimed: true })]);
      expect(result).not.toBeNull();
      expect(result!.matchedCalendarEventId).toBeNull();
      expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
      expect(result!.requiresReviewReason).toBe('TERRACE_DUPLICATE');
      expect(result!.confidenceScore).toBe(0.6);
    });

    it('still AUTO-links the same payment when the booking is unclaimed', () => {
      const result = matchTerraceBooking(input(), [candidate({ claimed: false })]);
      expect(result!.matchedCalendarEventId).toBe('event-001');
      expect(result!.classificationStatus).toBe('AUTO');
    });
  });

  // ── CAL-012: deposit awareness ───────────────────────────────────────────────

  describe('security deposit (CAL-012)', () => {
    it('flags a deposit-amount payment as TERRACE_DEPOSIT and never links it as rental', () => {
      const result = matchTerraceBooking(
        input({ amount: 900 }), // matches securityDepositAmount (900), not rental (1500)
        [candidate({ securityDepositAmount: 900 })],
      );
      expect(result).not.toBeNull();
      expect(result!.matchedCalendarEventId).toBeNull();
      expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
      expect(result!.requiresReviewReason).toBe('TERRACE_DEPOSIT');
    });

    it('ignores the deposit amount once the deposit has been received', () => {
      const result = matchTerraceBooking(
        input({ amount: 900 }),
        [candidate({ securityDepositAmount: 900, securityDepositStatus: 'RECEIVED' })],
      );
      // Deposit already settled → 900 matches neither rental nor an active deposit.
      expect(result).toBeNull();
    });

    it('forces TERRACE_DEPOSIT review when rental == deposit (amount is indistinguishable)', () => {
      const result = matchTerraceBooking(
        input({ amount: 1500 }),
        [candidate({ securityDepositAmount: 1500 })], // rental 1500 == deposit 1500
      );
      expect(result).not.toBeNull();
      expect(result!.matchedCalendarEventId).toBeNull();
      expect(result!.classificationStatus).toBe('NEEDS_REVIEW');
      expect(result!.requiresReviewReason).toBe('TERRACE_DEPOSIT');
    });
  });
});
