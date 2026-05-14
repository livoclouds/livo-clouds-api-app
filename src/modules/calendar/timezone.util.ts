import { BadRequestException } from '@nestjs/common';

export const MAX_TIMEZONE_LENGTH = 64;

/**
 * Returns true when `tz` is a valid IANA timezone identifier on the host
 * Node runtime. Implementation: hand the value to `Intl.DateTimeFormat` and
 * see whether it throws a `RangeError`. This mirrors how the V8 ICU layer
 * decides whether a zone exists, and avoids shipping a hand-maintained list.
 */
export function isValidIanaTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > MAX_TIMEZONE_LENGTH) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Throws BadRequestException('invalidTimezone') when `tz` is provided but is
 * not a valid IANA zone. `null` and `undefined` pass through untouched so the
 * caller can rely on the fall-back-to-condominium behavior.
 */
export function assertValidTimezone(tz: string | null | undefined): void {
  if (tz === null || tz === undefined) return;
  if (!isValidIanaTimezone(tz)) {
    throw new BadRequestException('invalidTimezone');
  }
}
