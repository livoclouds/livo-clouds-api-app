import {
  validateTerraceMetadata,
  TERRACE_BOOKING_DEFAULTS,
} from './terrace-metadata.validator';

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    terraceRentalAmount: 1500,
    securityDepositAmount: 1000,
    paymentStatus: 'PENDING',
    securityDepositStatus: 'PENDING',
    contractSigned: false,
    guestParkingRequested: false,
    setupNotes: '',
    postEventReviewed: false,
    damagesReported: false,
    cleaningIssueReported: false,
    depositDeductionAmount: 0,
    depositDeductionReason: '',
    postEventReviewNotes: '',
    ...overrides,
  };
}

describe('validateTerraceMetadata', () => {
  // ── Shape guards ────────────────────────────────────────────────────────────

  it('returns invalid for null', () => {
    const r = validateTerraceMetadata(null);
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/plain object/);
  });

  it('returns invalid for undefined', () => {
    const r = validateTerraceMetadata(undefined);
    expect(r.valid).toBe(false);
  });

  it('returns invalid for an array', () => {
    const r = validateTerraceMetadata([]);
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/plain object/);
  });

  it('rejects unknown fields', () => {
    const r = validateTerraceMetadata(validPayload({ extraField: 'oops' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/unknown fields/);
    expect((r as { valid: false; error: string }).error).toContain('extraField');
  });

  // ── Amount validation ───────────────────────────────────────────────────────

  it('rejects terraceRentalAmount as string', () => {
    const r = validateTerraceMetadata(validPayload({ terraceRentalAmount: '1500' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/terraceRentalAmount/);
  });

  it('rejects terraceRentalAmount as negative number', () => {
    const r = validateTerraceMetadata(validPayload({ terraceRentalAmount: -1 }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/terraceRentalAmount/);
  });

  it('rejects terraceRentalAmount as Infinity', () => {
    const r = validateTerraceMetadata(validPayload({ terraceRentalAmount: Infinity }));
    expect(r.valid).toBe(false);
  });

  it('rejects securityDepositAmount as string', () => {
    const r = validateTerraceMetadata(validPayload({ securityDepositAmount: '500' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/securityDepositAmount/);
  });

  it('rejects securityDepositAmount as negative number', () => {
    const r = validateTerraceMetadata(validPayload({ securityDepositAmount: -0.01 }));
    expect(r.valid).toBe(false);
  });

  it('accepts zero for both amounts', () => {
    const r = validateTerraceMetadata(
      validPayload({ terraceRentalAmount: 0, securityDepositAmount: 0 }),
    );
    expect(r.valid).toBe(true);
  });

  // ── Status enums ────────────────────────────────────────────────────────────

  it('rejects unknown paymentStatus', () => {
    const r = validateTerraceMetadata(validPayload({ paymentStatus: 'UNKNOWN' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/paymentStatus/);
  });

  it('accepts all valid paymentStatus values', () => {
    for (const status of ['PENDING', 'PAID']) {
      const r = validateTerraceMetadata(validPayload({ paymentStatus: status }));
      expect(r.valid).toBe(true);
    }
  });

  it('rejects unknown securityDepositStatus', () => {
    const r = validateTerraceMetadata(validPayload({ securityDepositStatus: 'INVALID' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/securityDepositStatus/);
  });

  it('accepts all valid securityDepositStatus values', () => {
    for (const status of ['PENDING', 'RECEIVED', 'RETURNED', 'RETAINED']) {
      const r = validateTerraceMetadata(validPayload({ securityDepositStatus: status }));
      expect(r.valid).toBe(true);
    }
  });

  // ── Boolean fields ──────────────────────────────────────────────────────────

  it('rejects contractSigned as string', () => {
    const r = validateTerraceMetadata(validPayload({ contractSigned: 'true' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/contractSigned/);
  });

  it('rejects contractSigned as number', () => {
    const r = validateTerraceMetadata(validPayload({ contractSigned: 1 }));
    expect(r.valid).toBe(false);
  });

  it('rejects guestParkingRequested as string', () => {
    const r = validateTerraceMetadata(validPayload({ guestParkingRequested: 'false' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/guestParkingRequested/);
  });

  // ── Optional string fields ──────────────────────────────────────────────────

  it('accepts object without optional setupNotes and postEventReviewNotes', () => {
    const { setupNotes: _s, postEventReviewNotes: _p, ...rest } = validPayload() as {
      setupNotes: string;
      postEventReviewNotes: string;
      [k: string]: unknown;
    };
    const r = validateTerraceMetadata(rest);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.data.setupNotes).toBe('');
      expect(r.data.postEventReviewNotes).toBe('');
    }
  });

  it('rejects setupNotes as number', () => {
    const r = validateTerraceMetadata(validPayload({ setupNotes: 123 }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/setupNotes/);
  });

  it('rejects postEventReviewNotes as number', () => {
    const r = validateTerraceMetadata(validPayload({ postEventReviewNotes: 42 }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/postEventReviewNotes/);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('accepts TERRACE_BOOKING_DEFAULTS as-is', () => {
    const r = validateTerraceMetadata(TERRACE_BOOKING_DEFAULTS);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.data).toEqual(TERRACE_BOOKING_DEFAULTS);
  });

  it('returns the fully typed data on success', () => {
    const r = validateTerraceMetadata(
      validPayload({
        terraceRentalAmount: 3000,
        securityDepositAmount: 500,
        paymentStatus: 'PAID',
        securityDepositStatus: 'RETURNED',
        contractSigned: true,
        guestParkingRequested: true,
        setupNotes: 'Chairs and sound',
        postEventReviewNotes: 'All returned',
      }),
    );
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.data.terraceRentalAmount).toBe(3000);
      expect(r.data.paymentStatus).toBe('PAID');
      expect(r.data.securityDepositStatus).toBe('RETURNED');
      expect(r.data.contractSigned).toBe(true);
    }
  });

  // ── Post-event review fields ────────────────────────────────────────────────

  it('accepts valid post-event review defaults embedded in payload', () => {
    const r = validateTerraceMetadata(validPayload());
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.data.postEventReviewed).toBe(false);
      expect(r.data.damagesReported).toBe(false);
      expect(r.data.cleaningIssueReported).toBe(false);
      expect(r.data.depositDeductionAmount).toBe(0);
      expect(r.data.depositDeductionReason).toBe('');
    }
  });

  it('accepts postEventReviewed true with valid post-event data', () => {
    const r = validateTerraceMetadata(
      validPayload({
        postEventReviewed: true,
        damagesReported: true,
        cleaningIssueReported: false,
        depositDeductionAmount: 200,
        depositDeductionReason: 'Broken chair',
        postEventReviewNotes: 'Minor damage to furniture',
      }),
    );
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.data.postEventReviewed).toBe(true);
      expect(r.data.damagesReported).toBe(true);
      expect(r.data.depositDeductionAmount).toBe(200);
      expect(r.data.depositDeductionReason).toBe('Broken chair');
    }
  });

  it('accepts old metadata without post-event review fields (backward compat)', () => {
    // Simulates an existing event saved before post-event review was added.
    const oldPayload = {
      terraceRentalAmount: 1500,
      securityDepositAmount: 1000,
      paymentStatus: 'PENDING',
      securityDepositStatus: 'PENDING',
      contractSigned: false,
      guestParkingRequested: false,
      setupNotes: '',
      postEventReviewNotes: '',
      // No postEventReviewed, damagesReported, etc.
    };
    const r = validateTerraceMetadata(oldPayload);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.data.postEventReviewed).toBe(false);
      expect(r.data.depositDeductionAmount).toBe(0);
    }
  });

  it('rejects depositDeductionAmount as negative', () => {
    const r = validateTerraceMetadata(validPayload({ depositDeductionAmount: -1 }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/depositDeductionAmount/);
  });

  it('rejects depositDeductionAmount greater than securityDepositAmount', () => {
    const r = validateTerraceMetadata(
      validPayload({ securityDepositAmount: 500, depositDeductionAmount: 600 }),
    );
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/cannot exceed/);
  });

  it('accepts depositDeductionAmount exactly equal to securityDepositAmount', () => {
    const r = validateTerraceMetadata(
      validPayload({
        securityDepositAmount: 1000,
        depositDeductionAmount: 1000,
        depositDeductionReason: 'Total loss',
      }),
    );
    expect(r.valid).toBe(true);
  });

  it('rejects depositDeductionAmount > 0 without a reason', () => {
    const r = validateTerraceMetadata(
      validPayload({ depositDeductionAmount: 200, depositDeductionReason: '' }),
    );
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/depositDeductionReason.*required/);
  });

  it('rejects depositDeductionAmount > 0 with whitespace-only reason', () => {
    const r = validateTerraceMetadata(
      validPayload({ depositDeductionAmount: 100, depositDeductionReason: '   ' }),
    );
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/depositDeductionReason.*required/);
  });

  it('accepts depositDeductionAmount 0 without a reason', () => {
    const r = validateTerraceMetadata(
      validPayload({ depositDeductionAmount: 0, depositDeductionReason: '' }),
    );
    expect(r.valid).toBe(true);
  });

  it('rejects postEventReviewed as string', () => {
    const r = validateTerraceMetadata(validPayload({ postEventReviewed: 'true' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/postEventReviewed/);
  });

  it('rejects damagesReported as string', () => {
    const r = validateTerraceMetadata(validPayload({ damagesReported: 'true' }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/damagesReported/);
  });

  it('rejects cleaningIssueReported as number', () => {
    const r = validateTerraceMetadata(validPayload({ cleaningIssueReported: 1 }));
    expect(r.valid).toBe(false);
    expect((r as { valid: false; error: string }).error).toMatch(/cleaningIssueReported/);
  });
});
