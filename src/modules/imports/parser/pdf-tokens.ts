import { round2 } from '../../../common/utils/money.util';
import type { AmountIssue } from './types';

// ---------------------------------------------------------------------------
// Shared date / time / amount primitives for the PDF parsers (positional and
// the legacy line-based fallback).
// ---------------------------------------------------------------------------

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
// Abbreviated months as printed by BanBajío ("31-May-2026"). Spanish 3-letter
// forms plus a few English abbreviations that differ from the Spanish ones.
const MONTH_ABBR: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8,
  sep: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
};

export const DATE_SPANISH_RE =
  /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i;
// "31-May-2026" / "02-Jun-2026" — dd-MonAbbr-yyyy (BanBajío and similar exports).
export const DATE_MONABBR_RE = /\b(\d{1,2})[-/]([A-Za-zÁÉÍÓÚáéíóúñ]{3,4})[-/](\d{4})\b/;
export const DATE_SLASH_RE = /(\d{1,2})\/(\d{2})\/(\d{4})/;
export const DATE_ISO_RE = /(\d{4})-(\d{2})-(\d{2})/;
export const TIME_RE = /\b(\d{2}:\d{2}(?::\d{2})?)\b/;
export const AMOUNT_RE = /\b(\d{1,3}(?:,\d{3})*(?:\.\d{2}))\b/g;
// European-format amount ("1.234,56") — AMOUNT_RE only matches US format, so
// these are flagged and rejected rather than silently mis-parsed (ENGINE-029).
export const EURO_AMOUNT_LINE_RE = /\b\d{1,3}(?:\.\d{3})+,\d{2}\b/;

// Single-token classifiers used by the positional parser.
export const TOKEN_TIME_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
export const TOKEN_MONEY_RE = /^\$?\s?-?[\d,]+\.\d{2}$/;
export const TOKEN_RECEIPT_RE = /^\d{6,}$/;
export const TOKEN_INDEX_RE = /^\d{1,4}$/;
export const TOKEN_DATE_MONABBR_RE = /^\d{1,2}[-/][A-Za-zÁÉÍÓÚáéíóúñ]{3,4}[-/]\d{4}$/;

// Statement footer / disclaimer fragments that fall inside the description
// column band on the final page and would otherwise pollute the last row's
// description. Matching fragments are dropped (BanBajío boilerplate).
export const FOOTER_NOISE_RE =
  /(Consultas y aclaraciones|La informaci[oó]n contenida|Jardines del Campestre|Manuel J\. Clouthier|Desde el extranjero|carácter informativo)/i;

/** Parse any supported date format into an ISO `YYYY-MM-DD` string, or null. */
export function parseDate(line: string): string | null {
  const m1 = line.match(DATE_SPANISH_RE);
  if (m1) {
    const day = m1[1].padStart(2, '0');
    const month = String(SPANISH_MONTHS[m1[2].toLowerCase()] ?? 0).padStart(2, '0');
    if (month !== '00') return `${m1[3]}-${month}-${day}`;
  }

  const mAbbr = line.match(DATE_MONABBR_RE);
  if (mAbbr) {
    const key = mAbbr[2]
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .slice(0, 3);
    const month = MONTH_ABBR[key];
    if (month) {
      return `${mAbbr[3]}-${String(month).padStart(2, '0')}-${mAbbr[1].padStart(2, '0')}`;
    }
  }

  const m2 = line.match(DATE_SLASH_RE);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;

  const m3 = line.match(DATE_ISO_RE);
  if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;

  return null;
}

/** Parse a single amount token, flagging ambiguous/unparseable values. */
export function parseAmountToken(raw: string): { value: number; issue?: AmountIssue } {
  if (EURO_AMOUNT_LINE_RE.test(raw)) {
    return { value: NaN, issue: 'ambiguousDecimal' };
  }
  const cleaned = raw.replace(/[$\s,]/g, '');
  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) return { value: NaN, issue: 'unparseable' };
  return { value: round2(value) };
}

/** Accent-fold + collapse whitespace + lowercase a header cell for matching. */
export function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
