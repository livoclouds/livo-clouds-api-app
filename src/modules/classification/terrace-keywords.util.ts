/**
 * Single source of truth for terrace-keyword normalization.
 *
 * Used by both the Pass 0.5 matcher (`terrace-booking-matcher.ts`) and the
 * settings DTO Transform (`update-terrace-settings.dto.ts`) so user-supplied
 * keywords are stored and matched against the same normalized form. Keeping
 * one canonical helper avoids subtle drift where the matcher folds accents
 * but the DTO doesn't (or vice-versa) and a saved keyword silently fails to
 * fire at classification time.
 */

export function normalizeTerraceKeyword(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTerraceKeywordList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const norm = normalizeTerraceKeyword(v);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}
