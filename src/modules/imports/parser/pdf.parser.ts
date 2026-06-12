import pdfParse from 'pdf-parse';
import type { ParsedRow } from './types';
import { round2 } from '../../../common/utils/money.util';
import {
  buildAliasIndex,
  DEFAULT_FIELD_DEFINITIONS,
  type FieldDefinition,
  findMissingRequiredFields,
  ImportProfileMismatchError,
  matchHeaderToFieldKey,
} from './default-aliases';

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const DATE_SPANISH_RE =
  /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i;
const DATE_SLASH_RE = /(\d{1,2})\/(\d{2})\/(\d{4})/;
const DATE_ISO_RE = /(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /\b(\d{2}:\d{2}(?::\d{2})?)\b/;
const AMOUNT_RE = /\b(\d{1,3}(?:,\d{3})*(?:\.\d{2}))\b/g;
// European-format amount ("1.234,56") — AMOUNT_RE only matches US format, so
// these silently vanished from line parsing. Positional attribution is
// impossible in line-based PDF extraction, so a matching row is flagged and
// rejected instead of guessed at (ENGINE-029).
const EURO_AMOUNT_LINE_RE = /\b\d{1,3}(?:\.\d{3})+,\d{2}\b/;

function parseDate(line: string): string | null {
  const m1 = line.match(DATE_SPANISH_RE);
  if (m1) {
    const day = m1[1].padStart(2, '0');
    const month = String(SPANISH_MONTHS[m1[2].toLowerCase()] ?? 0).padStart(
      2,
      '0',
    );
    const year = m1[3];
    if (month !== '00') return `${year}-${month}-${day}`;
  }

  const m2 = line.match(DATE_SLASH_RE);
  if (m2) {
    const year = m2[3];
    const month = m2[2].padStart(2, '0');
    const day = m2[1].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const m3 = line.match(DATE_ISO_RE);
  if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;

  return null;
}

function extractAmounts(line: string): number[] {
  const cleaned = line.replace(DATE_SPANISH_RE, '').replace(DATE_SLASH_RE, '');
  const matches = cleaned.matchAll(AMOUNT_RE);
  return Array.from(matches).map((m) =>
    round2(parseFloat(m[1].replace(/,/g, ''))),
  );
}

function tokenizeHeader(line: string): string[] {
  return line
    .split(/[\s|·•\t]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function isHeaderLine(
  line: string,
  aliasIndex: { key: string; normalizedAliases: string[] }[],
): { isHeader: boolean; matchedKeys: Set<string>; tokens: string[] } {
  const tokens = tokenizeHeader(line);
  const matchedKeys = new Set<string>();
  for (const token of tokens) {
    const key = matchHeaderToFieldKey(token, aliasIndex);
    if (key) matchedKeys.add(key);
  }
  if (matchedKeys.size < 3) {
    const lower = line.toLowerCase();
    for (const entry of aliasIndex) {
      if (entry.normalizedAliases.some((alias) => lower.includes(alias))) {
        matchedKeys.add(entry.key);
      }
    }
  }
  return { isHeader: matchedKeys.size >= 3, matchedKeys, tokens };
}

export interface PdfParseResult {
  transactions: ParsedRow[];
  warnings: string[];
}

export interface PdfParseOptions {
  fields?: FieldDefinition[];
}

export async function parsePdfBuffer(
  buffer: Buffer,
  options: PdfParseOptions = {},
): Promise<PdfParseResult> {
  const fields = options.fields && options.fields.length > 0
    ? options.fields
    : DEFAULT_FIELD_DEFINITIONS;
  const aliasIndex = buildAliasIndex(fields);

  const warnings: string[] = [];

  let data: Awaited<ReturnType<typeof pdfParse>>;
  try {
    data = await pdfParse(buffer);
  } catch {
    return {
      transactions: [],
      warnings: ['Could not read PDF file. The file may be corrupted or encrypted.'],
    };
  }

  const text = data.text;
  if (!text || text.trim().length < 50) {
    return {
      transactions: [],
      warnings: [
        'This PDF appears to be image-based (scanned). Text extraction is not possible for scanned documents. Please use a PDF exported directly from your banking portal.',
      ],
    };
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let headerLineIndex = -1;
  let headerMatchedKeys = new Set<string>();
  let headerTokens: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const detection = isHeaderLine(lines[i], aliasIndex);
    if (detection.isHeader) {
      headerLineIndex = i;
      headerMatchedKeys = detection.matchedKeys;
      headerTokens = detection.tokens;
      break;
    }
  }

  if (headerLineIndex === -1) {
    warnings.push(
      'Could not detect column headers in the PDF. Attempting best-effort line parsing.',
    );
  } else {
    const missing = findMissingRequiredFields(fields, headerMatchedKeys);
    if (missing.length > 0) {
      throw new ImportProfileMismatchError(missing, headerTokens);
    }
  }

  const dataLines =
    headerLineIndex !== -1 ? lines.slice(headerLineIndex + 1) : lines;

  const transactions: ParsedRow[] = [];
  let currentTx: Partial<ParsedRow> | null = null;

  for (const line of dataLines) {
    const dateStr = parseDate(line);

    if (dateStr) {
      if (currentTx && currentTx.date && currentTx.description !== undefined) {
        transactions.push(currentTx as ParsedRow);
      }

      const amounts = extractAmounts(line);
      const timeMatch = line.match(TIME_RE);

      let charges = 0;
      let credits = 0;
      let balance = 0;

      if (amounts.length === 3) {
        [charges, credits, balance] = amounts;
      } else if (amounts.length === 2) {
        [charges, balance] = amounts;
      } else if (amounts.length === 1) {
        balance = amounts[0];
      }

      const descriptionPart = line
        .replace(DATE_SPANISH_RE, '')
        .replace(DATE_SLASH_RE, '')
        .replace(TIME_RE, '')
        .replace(AMOUNT_RE, '')
        .replace(/\s+/g, ' ')
        .trim();

      currentTx = {
        date: dateStr,
        time: timeMatch ? timeMatch[1] : undefined,
        description: descriptionPart,
        charges,
        credits,
        balance,
        flowType: credits > 0 ? 'income' : 'expense',
        ...(EURO_AMOUNT_LINE_RE.test(line) && {
          parseIssues: [
            {
              field: 'charges' as const,
              issue: 'ambiguousDecimal' as const,
              raw: line.match(EURO_AMOUNT_LINE_RE)![0],
            },
          ],
        }),
      };
    } else if (currentTx && !isHeaderLine(line, aliasIndex).isHeader) {
      const amounts = extractAmounts(line);
      if (amounts.length > 0 && currentTx.balance === 0) {
        const [c, cr, b] = amounts;
        if (b !== undefined) {
          currentTx.charges = c ?? 0;
          currentTx.credits = cr ?? 0;
          currentTx.balance = b;
          currentTx.flowType =
            (currentTx.credits ?? 0) > 0 ? 'income' : 'expense';
        }
      } else {
        currentTx.description = [currentTx.description, line]
          .filter(Boolean)
          .join(' ');
      }
    }
  }

  if (currentTx && currentTx.date && currentTx.description !== undefined) {
    transactions.push(currentTx as ParsedRow);
  }

  if (transactions.length === 0) {
    warnings.push(
      'No transactions could be extracted from this PDF. The format may not be supported.',
    );
  }

  return { transactions, warnings };
}
