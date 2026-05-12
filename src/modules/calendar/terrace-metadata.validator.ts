// ─── Types ────────────────────────────────────────────────────────────────────

export type TerracePaymentStatus = 'PENDING' | 'PAID';
export type TerraceDepositStatus = 'PENDING' | 'RECEIVED' | 'RETURNED' | 'RETAINED';

export interface TerraceBookingMetadata {
  // Financial
  terraceRentalAmount: number;
  securityDepositAmount: number;
  paymentStatus: TerracePaymentStatus;
  securityDepositStatus: TerraceDepositStatus;
  // Pre-event
  contractSigned: boolean;
  guestParkingRequested: boolean;
  setupNotes: string;
  // Post-event review
  postEventReviewed: boolean;
  damagesReported: boolean;
  cleaningIssueReported: boolean;
  depositDeductionAmount: number;
  depositDeductionReason: string;
  postEventReviewNotes: string;
}

export type TerraceMetadataValidationResult =
  | { valid: true; data: TerraceBookingMetadata }
  | { valid: false; error: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_PAYMENT_STATUSES: readonly TerracePaymentStatus[] = ['PENDING', 'PAID'];
const VALID_DEPOSIT_STATUSES: readonly TerraceDepositStatus[] = [
  'PENDING',
  'RECEIVED',
  'RETURNED',
  'RETAINED',
];

const ALLOWED_FIELDS = new Set([
  'terraceRentalAmount',
  'securityDepositAmount',
  'paymentStatus',
  'securityDepositStatus',
  'contractSigned',
  'guestParkingRequested',
  'setupNotes',
  'postEventReviewed',
  'damagesReported',
  'cleaningIssueReported',
  'depositDeductionAmount',
  'depositDeductionReason',
  'postEventReviewNotes',
]);

// Defaults mirror the frontend TERRACE_DEFAULTS to avoid silent divergence.
export const TERRACE_BOOKING_DEFAULTS: TerraceBookingMetadata = {
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
};

// ─── Validator ────────────────────────────────────────────────────────────────

export function validateTerraceMetadata(raw: unknown): TerraceMetadataValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'metadata must be a plain object for TERRACE_BOOKING' };
  }

  const m = raw as Record<string, unknown>;

  const extraFields = Object.keys(m).filter((k) => !ALLOWED_FIELDS.has(k));
  if (extraFields.length > 0) {
    return { valid: false, error: `metadata contains unknown fields: ${extraFields.join(', ')}` };
  }

  // ── Financial amounts ──────────────────────────────────────────────────────

  if (
    typeof m.terraceRentalAmount !== 'number' ||
    !isFinite(m.terraceRentalAmount) ||
    m.terraceRentalAmount < 0
  ) {
    return { valid: false, error: 'metadata.terraceRentalAmount must be a finite number >= 0' };
  }

  if (
    typeof m.securityDepositAmount !== 'number' ||
    !isFinite(m.securityDepositAmount) ||
    m.securityDepositAmount < 0
  ) {
    return { valid: false, error: 'metadata.securityDepositAmount must be a finite number >= 0' };
  }

  // ── Status enums ───────────────────────────────────────────────────────────

  if (!VALID_PAYMENT_STATUSES.includes(m.paymentStatus as TerracePaymentStatus)) {
    return {
      valid: false,
      error: `metadata.paymentStatus must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}`,
    };
  }

  if (!VALID_DEPOSIT_STATUSES.includes(m.securityDepositStatus as TerraceDepositStatus)) {
    return {
      valid: false,
      error: `metadata.securityDepositStatus must be one of: ${VALID_DEPOSIT_STATUSES.join(', ')}`,
    };
  }

  // ── Pre-event booleans ─────────────────────────────────────────────────────

  if (typeof m.contractSigned !== 'boolean') {
    return { valid: false, error: 'metadata.contractSigned must be a boolean' };
  }

  if (typeof m.guestParkingRequested !== 'boolean') {
    return { valid: false, error: 'metadata.guestParkingRequested must be a boolean' };
  }

  if (m.setupNotes !== undefined && typeof m.setupNotes !== 'string') {
    return { valid: false, error: 'metadata.setupNotes must be a string' };
  }

  // ── Post-event review fields (optional with safe defaults for old events) ──

  // Resolve with defaults when fields are absent (backward compat with existing events).
  const postEventReviewed = m.postEventReviewed === undefined ? false : m.postEventReviewed;
  const damagesReported = m.damagesReported === undefined ? false : m.damagesReported;
  const cleaningIssueReported = m.cleaningIssueReported === undefined ? false : m.cleaningIssueReported;
  const depositDeductionAmount = m.depositDeductionAmount === undefined ? 0 : m.depositDeductionAmount;
  const depositDeductionReason = m.depositDeductionReason === undefined ? '' : m.depositDeductionReason;

  if (typeof postEventReviewed !== 'boolean') {
    return { valid: false, error: 'metadata.postEventReviewed must be a boolean' };
  }

  if (typeof damagesReported !== 'boolean') {
    return { valid: false, error: 'metadata.damagesReported must be a boolean' };
  }

  if (typeof cleaningIssueReported !== 'boolean') {
    return { valid: false, error: 'metadata.cleaningIssueReported must be a boolean' };
  }

  if (
    typeof depositDeductionAmount !== 'number' ||
    !isFinite(depositDeductionAmount) ||
    depositDeductionAmount < 0
  ) {
    return { valid: false, error: 'metadata.depositDeductionAmount must be a finite number >= 0' };
  }

  // Deduction cannot exceed the original security deposit.
  if (depositDeductionAmount > (m.securityDepositAmount as number)) {
    return {
      valid: false,
      error: 'metadata.depositDeductionAmount cannot exceed securityDepositAmount',
    };
  }

  if (typeof depositDeductionReason !== 'string') {
    return { valid: false, error: 'metadata.depositDeductionReason must be a string' };
  }

  // Reason is required when a deduction is recorded.
  if (depositDeductionAmount > 0 && !depositDeductionReason.trim()) {
    return {
      valid: false,
      error: 'metadata.depositDeductionReason is required when depositDeductionAmount > 0',
    };
  }

  if (m.postEventReviewNotes !== undefined && typeof m.postEventReviewNotes !== 'string') {
    return { valid: false, error: 'metadata.postEventReviewNotes must be a string' };
  }

  return {
    valid: true,
    data: {
      terraceRentalAmount: m.terraceRentalAmount as number,
      securityDepositAmount: m.securityDepositAmount as number,
      paymentStatus: m.paymentStatus as TerracePaymentStatus,
      securityDepositStatus: m.securityDepositStatus as TerraceDepositStatus,
      contractSigned: m.contractSigned as boolean,
      guestParkingRequested: m.guestParkingRequested as boolean,
      setupNotes: typeof m.setupNotes === 'string' ? m.setupNotes : '',
      postEventReviewed,
      damagesReported,
      cleaningIssueReported,
      depositDeductionAmount,
      depositDeductionReason,
      postEventReviewNotes: typeof m.postEventReviewNotes === 'string' ? m.postEventReviewNotes : '',
    },
  };
}
