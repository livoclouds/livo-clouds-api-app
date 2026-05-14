import { BadRequestException } from '@nestjs/common';
import {
  MAX_TIMEZONE_LENGTH,
  assertValidTimezone,
  isValidIanaTimezone,
} from './timezone.util';

describe('isValidIanaTimezone', () => {
  it('accepts well-known IANA zones', () => {
    expect(isValidIanaTimezone('America/Mexico_City')).toBe(true);
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('Europe/Madrid')).toBe(true);
    expect(isValidIanaTimezone('UTC')).toBe(true);
  });

  it('rejects empty strings, non-strings, and gibberish', () => {
    expect(isValidIanaTimezone('')).toBe(false);
    expect(isValidIanaTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidIanaTimezone('not-a-timezone')).toBe(false);
    // @ts-expect-error — guard against runtime non-strings
    expect(isValidIanaTimezone(null)).toBe(false);
    // @ts-expect-error — guard against runtime non-strings
    expect(isValidIanaTimezone(undefined)).toBe(false);
    // @ts-expect-error — guard against runtime non-strings
    expect(isValidIanaTimezone(42)).toBe(false);
  });

  it('rejects values longer than MAX_TIMEZONE_LENGTH', () => {
    const big = 'A'.repeat(MAX_TIMEZONE_LENGTH + 1);
    expect(isValidIanaTimezone(big)).toBe(false);
  });
});

describe('assertValidTimezone', () => {
  it('passes through null and undefined silently', () => {
    expect(() => assertValidTimezone(null)).not.toThrow();
    expect(() => assertValidTimezone(undefined)).not.toThrow();
  });

  it('passes through a valid IANA zone', () => {
    expect(() => assertValidTimezone('America/Mexico_City')).not.toThrow();
  });

  it('throws BadRequestException("invalidTimezone") on bad input', () => {
    expect(() => assertValidTimezone('not-a-timezone')).toThrow(BadRequestException);
    try {
      assertValidTimezone('not-a-timezone');
    } catch (err) {
      expect((err as BadRequestException).message).toBe('invalidTimezone');
    }
  });
});
