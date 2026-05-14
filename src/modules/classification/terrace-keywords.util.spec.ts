import { normalizeTerraceKeyword, normalizeTerraceKeywordList } from './terrace-keywords.util';

describe('terrace-keywords.util', () => {
  describe('normalizeTerraceKeyword', () => {
    it('strips diacritics', () => {
      expect(normalizeTerraceKeyword('Salón')).toBe('salon');
      expect(normalizeTerraceKeyword('jardín')).toBe('jardin');
    });

    it('lowercases', () => {
      expect(normalizeTerraceKeyword('TERRAZA')).toBe('terraza');
    });

    it('collapses inner whitespace and trims edges', () => {
      expect(normalizeTerraceKeyword('  club   house  ')).toBe('club house');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(normalizeTerraceKeyword('   ')).toBe('');
    });
  });

  describe('normalizeTerraceKeywordList', () => {
    it('returns [] for non-array input', () => {
      expect(normalizeTerraceKeywordList(undefined)).toEqual([]);
      expect(normalizeTerraceKeywordList(null)).toEqual([]);
      expect(normalizeTerraceKeywordList('salon')).toEqual([]);
      expect(normalizeTerraceKeywordList({ 0: 'salon' })).toEqual([]);
    });

    it('drops non-string entries', () => {
      expect(normalizeTerraceKeywordList(['salon', 123, null, true])).toEqual(['salon']);
    });

    it('drops empty and whitespace-only entries', () => {
      expect(normalizeTerraceKeywordList(['salon', '', '  ', 'kiosko'])).toEqual([
        'salon',
        'kiosko',
      ]);
    });

    it('normalizes accents and case before dedupe so equivalent keywords collapse', () => {
      expect(
        normalizeTerraceKeywordList(['Salón', 'salon', 'SALÓN', 'kiosko']),
      ).toEqual(['salon', 'kiosko']);
    });

    it('preserves the first-seen order when collapsing duplicates', () => {
      expect(normalizeTerraceKeywordList(['kiosko', 'salon', 'KIOSKO'])).toEqual([
        'kiosko',
        'salon',
      ]);
    });

    it('collapses surrounding whitespace before dedupe', () => {
      expect(normalizeTerraceKeywordList(['  salon  ', 'salon'])).toEqual(['salon']);
    });
  });
});
