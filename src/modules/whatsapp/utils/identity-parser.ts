/**
 * Lightweight, dependency-free heuristics that pull a unit number and a likely
 * full name out of a free-text WhatsApp reply during identity capture.
 *
 * It is deliberately conservative: when confidence is low it returns `null`
 * rather than guessing, so the bot can re-prompt instead of committing wrong
 * data. It never throws — malformed input simply yields `{ null, null }`.
 */

export interface ParsedIdentity {
  capturedUnitNumber: string | null;
  capturedName: string | null;
}

// Keyword-anchored unit: "casa 47", "unidad #3a", "depto 200", "departamento 12".
const KEYWORD_UNIT = /(?:casa|unidad|depto|dpto|departamento)\s*#?\s*(\d+[a-z]?)\b/i;

// Standalone numeric token anywhere: start of string, after whitespace, or after "#".
const STANDALONE_UNIT = /(?:^|[\s#])(\d+[a-z]?)(?=[\s,.;:]|$)/i;

// Tokens stripped before name extraction (Spanish connectors + unit keywords).
const STOPWORDS = new Set([
  'casa',
  'unidad',
  'depto',
  'dpto',
  'departamento',
  'numero',
  'num',
  'no',
  'soy',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'mi',
  'me',
  'llamo',
  'nombre',
  'es',
  'y',
  'en',
  'un',
  'una',
  'hola',
  'buenas',
  'buenos',
  'dias',
  'tardes',
  'noches',
]);

const MAX_NAME_TOKENS = 5;

function foldDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** A token counts as a name word if it is alphabetic, length >= 2, no digits. */
function isNameToken(raw: string): boolean {
  const cleaned = raw.replace(/^[^\p{L}]+|[^\p{L}.'-]+$/gu, '');
  if (cleaned.length < 2) return false;
  if (/\d/.test(cleaned)) return false;
  return /^[\p{L}][\p{L}.'-]*$/u.test(cleaned);
}

function cleanToken(raw: string): string {
  return raw.replace(/^[^\p{L}]+|[^\p{L}.'-]+$/gu, '');
}

export function parseIdentity(text: string): ParsedIdentity {
  try {
    if (typeof text !== 'string') {
      return { capturedUnitNumber: null, capturedName: null };
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { capturedUnitNumber: null, capturedName: null };
    }

    let capturedUnitNumber: string | null = null;
    let unitMatchStart = -1;
    let unitMatchEnd = -1;

    const keywordMatch = KEYWORD_UNIT.exec(trimmed);
    if (keywordMatch) {
      capturedUnitNumber = keywordMatch[1].toUpperCase();
      unitMatchStart = keywordMatch.index;
      unitMatchEnd = keywordMatch.index + keywordMatch[0].length;
    } else {
      const standaloneMatch = STANDALONE_UNIT.exec(trimmed);
      if (standaloneMatch) {
        capturedUnitNumber = standaloneMatch[1].toUpperCase();
        unitMatchStart = standaloneMatch.index;
        unitMatchEnd = standaloneMatch.index + standaloneMatch[0].length;
      }
    }

    // Build the name candidate from the text with the unit span removed.
    const nameSource =
      unitMatchStart >= 0
        ? `${trimmed.slice(0, unitMatchStart)} ${trimmed.slice(unitMatchEnd)}`
        : trimmed;

    const nameTokens = nameSource
      .split(/\s+/)
      .map(cleanToken)
      .filter((token) => token.length > 0)
      .filter((token) => !STOPWORDS.has(foldDiacritics(token).toLowerCase()))
      .filter(isNameToken)
      .slice(0, MAX_NAME_TOKENS);

    const capturedName = nameTokens.length >= 2 ? nameTokens.join(' ') : null;

    return { capturedUnitNumber, capturedName };
  } catch {
    return { capturedUnitNumber: null, capturedName: null };
  }
}
