/**
 * Mexican phone-number normalization (Phase 4 — Communications).
 *
 * Converts the common stored forms into E.164. The rules are intentionally
 * conservative: only numbers that are unambiguously Mexican are rewritten.
 * Anything ambiguous, non-Mexican, or malformed is left untouched so an
 * automated batch run can never corrupt resident contact data.
 */

export type PhoneNormalizationOutcome =
  | 'normalized'
  | 'alreadyValid'
  | 'skipped'
  | 'invalid';

export interface PhoneNormalizationResult {
  outcome: PhoneNormalizationOutcome;
  /** The original input, unchanged. */
  original: string;
  /** The E.164 value — present for `normalized` and `alreadyValid` only. */
  value: string | null;
}

/**
 * Normalizes a single phone number.
 *
 * - `normalized`   — safely rewritten to E.164 (`value` set).
 * - `alreadyValid` — already a valid Mexican E.164 number (`value` set).
 * - `skipped`      — looks like a non-Mexican / ambiguous number (left as-is).
 * - `invalid`      — empty or malformed (left as-is).
 */
export function normalizeMexicanPhone(
  raw: string | null | undefined,
): PhoneNormalizationResult {
  const original = raw ?? '';
  if (!raw || raw.trim() === '') {
    return { outcome: 'invalid', original, value: null };
  }

  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith('+');
  // Drop spaces, dashes, parentheses, dots — keep digits only.
  const digits = trimmed.replace(/\D/g, '');

  if (hadPlus) {
    // +52 + 10 digits — already a valid Mexican E.164 number.
    if (/^52\d{10}$/.test(digits)) {
      return { outcome: 'alreadyValid', original, value: `+${digits}` };
    }
    // Legacy +52 1 + 10 digits (old mobile prefix) — drop the extra 1.
    if (/^521\d{10}$/.test(digits)) {
      return { outcome: 'normalized', original, value: `+52${digits.slice(3)}` };
    }
    // Some other country code already in E.164 — not Mexican, do not touch.
    if (/^\d{8,15}$/.test(digits)) {
      return { outcome: 'skipped', original, value: null };
    }
    return { outcome: 'invalid', original, value: null };
  }

  // Bare 10-digit Mexican number — the most common stored form.
  if (/^\d{10}$/.test(digits)) {
    return { outcome: 'normalized', original, value: `+52${digits}` };
  }
  // 52 + 10 digits without the leading plus.
  if (/^52\d{10}$/.test(digits)) {
    return { outcome: 'normalized', original, value: `+${digits}` };
  }
  // Legacy 52 1 + 10 digits without the leading plus.
  if (/^521\d{10}$/.test(digits)) {
    return { outcome: 'normalized', original, value: `+52${digits.slice(3)}` };
  }
  // Longer digit strings without a country-code marker are ambiguous.
  if (/^\d{11,15}$/.test(digits)) {
    return { outcome: 'skipped', original, value: null };
  }
  return { outcome: 'invalid', original, value: null };
}

/**
 * Masks a phone number for display, keeping only the last four digits
 * (e.g. "+528112345678" → "••••5678"). Used so dry-run summaries do not
 * expose full resident phone numbers.
 */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '•'.repeat(digits.length);
  return `••••${digits.slice(-4)}`;
}
