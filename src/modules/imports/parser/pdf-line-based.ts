import type { ParsedRow } from './types';
import { round2 } from '../../../common/utils/money.util';
import {
  type FieldDefinition,
  findMissingRequiredFields,
  ImportProfileMismatchError,
  matchHeaderToFieldKey,
} from './default-aliases';
import {
  AMOUNT_RE,
  DATE_MONABBR_RE,
  DATE_SLASH_RE,
  DATE_SPANISH_RE,
  EURO_AMOUNT_LINE_RE,
  parseDate,
  TIME_RE,
} from './pdf-tokens';

// ---------------------------------------------------------------------------
// Legacy line-based fallback. Preserved for layouts the positional pass cannot
// reconstruct — e.g. banks that emit a single-line, single-column text dump.
// Understands the dd-MonAbbr-yyyy date format via the shared parseDate.
// ---------------------------------------------------------------------------

function extractAmounts(line: string): number[] {
  const cleaned = line
    .replace(DATE_SPANISH_RE, '')
    .replace(DATE_MONABBR_RE, '')
    .replace(DATE_SLASH_RE, '');
  return Array.from(cleaned.matchAll(AMOUNT_RE)).map((m) =>
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

export function parseLineBased(
  text: string,
  aliasIndex: { key: string; normalizedAliases: string[] }[],
  fields: FieldDefinition[],
): { transactions: ParsedRow[]; warnings: string[] } {
  const warnings: string[] = [];
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

  const dataLines = headerLineIndex !== -1 ? lines.slice(headerLineIndex + 1) : lines;
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
      if (amounts.length === 3) [charges, credits, balance] = amounts;
      else if (amounts.length === 2) [charges, balance] = amounts;
      else if (amounts.length === 1) balance = amounts[0];

      const descriptionPart = line
        .replace(DATE_SPANISH_RE, '')
        .replace(DATE_MONABBR_RE, '')
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
          currentTx.flowType = (currentTx.credits ?? 0) > 0 ? 'income' : 'expense';
        }
      } else {
        currentTx.description = [currentTx.description, line].filter(Boolean).join(' ');
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
