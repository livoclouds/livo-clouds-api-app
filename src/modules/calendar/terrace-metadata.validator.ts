// ─── Types ────────────────────────────────────────────────────────────────────

export type TerracePaymentStatus = 'PENDING' | 'PAID';
export type TerraceDepositStatus = 'PENDING' | 'RECEIVED' | 'RETURNED' | 'RETAINED';

export interface TerraceBookingMetadata {
  terraceRentalAmount: number;
  securityDepositAmount: number;
  paymentStatus: TerracePaymentStatus;
  securityDepositStatus: TerraceDepositStatus;
  contractSigned: boolean;
  guestParkingRequested: boolean;
  setupNotes: string;
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
  'postEventReviewNotes',
]);

// Defaults mirror the frontend TERRACE_DEFAULTS to avoid silent divergence.
// Move to per-condominium configuration once a settings surface is available.
export const TERRACE_BOOKING_DEFAULTS: TerraceBookingMetadata = {
  terraceRentalAmount: 1500,
  securityDepositAmount: 1000,
  paymentStatus: 'PENDING',
  securityDepositStatus: 'PENDING',
  contractSigned: false,
  guestParkingRequested: false,
  setupNotes: '',
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

  if (typeof m.contractSigned !== 'boolean') {
    return { valid: false, error: 'metadata.contractSigned must be a boolean' };
  }

  if (typeof m.guestParkingRequested !== 'boolean') {
    return { valid: false, error: 'metadata.guestParkingRequested must be a boolean' };
  }

  if (m.setupNotes !== undefined && typeof m.setupNotes !== 'string') {
    return { valid: false, error: 'metadata.setupNotes must be a string' };
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
      postEventReviewNotes: typeof m.postEventReviewNotes === 'string' ? m.postEventReviewNotes : '',
    },
  };
}
