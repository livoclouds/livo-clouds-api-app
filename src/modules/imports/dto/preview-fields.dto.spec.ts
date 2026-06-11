import { BadRequestException } from '@nestjs/common';
import {
  parseJsonStringArray,
  validatePreviewFields,
} from './preview-fields.dto';

const HASH = 'a'.repeat(64);

describe('preview-fields (ENGINE-061)', () => {
  describe('parseJsonStringArray', () => {
    it('returns [] for undefined or blank input', () => {
      expect(parseJsonStringArray(undefined, 'storedHashes')).toEqual([]);
      expect(parseJsonStringArray('   ', 'storedHashes')).toEqual([]);
    });

    it('parses a valid JSON array', () => {
      expect(parseJsonStringArray(`["${HASH}"]`, 'storedHashes')).toEqual([
        HASH,
      ]);
    });

    it('throws 400 VALIDATION_FAILED on malformed JSON instead of silently ignoring', () => {
      expect(() => parseJsonStringArray('not-json', 'storedHashes')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('validatePreviewFields', () => {
    it('accepts a valid payload', () => {
      const dto = validatePreviewFields({
        storedHashes: [HASH],
        clientIds: ['client-1'],
      });
      expect(dto.storedHashes).toEqual([HASH]);
      expect(dto.clientIds).toEqual(['client-1']);
    });

    it('accepts empty arrays', () => {
      const dto = validatePreviewFields({ storedHashes: [], clientIds: [] });
      expect(dto.storedHashes).toEqual([]);
      expect(dto.clientIds).toEqual([]);
    });

    it('rejects a non-array storedHashes (e.g. a JSON object)', () => {
      expect(() =>
        validatePreviewFields({ storedHashes: { evil: true }, clientIds: [] }),
      ).toThrow(BadRequestException);
    });

    it('rejects storedHashes beyond the CheckHashesDto cap of 10', () => {
      const oversized = Array.from({ length: 11 }, () => HASH);
      expect(() =>
        validatePreviewFields({ storedHashes: oversized, clientIds: [] }),
      ).toThrow(BadRequestException);
    });

    it('rejects a non-hex storedHashes entry', () => {
      expect(() =>
        validatePreviewFields({
          storedHashes: ['=HYPERLINK("http://evil")'],
          clientIds: [],
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects more than 5 clientIds (one per uploadable file)', () => {
      expect(() =>
        validatePreviewFields({
          storedHashes: [],
          clientIds: ['a', 'b', 'c', 'd', 'e', 'f'],
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects a clientId longer than 64 characters', () => {
      expect(() =>
        validatePreviewFields({
          storedHashes: [],
          clientIds: ['x'.repeat(65)],
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects non-string clientIds entries', () => {
      expect(() =>
        validatePreviewFields({ storedHashes: [], clientIds: [123] }),
      ).toThrow(BadRequestException);
    });
  });
});
