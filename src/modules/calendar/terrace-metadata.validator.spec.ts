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
});
