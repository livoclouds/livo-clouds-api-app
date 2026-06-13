import type { ParsedRow } from './types';
import {
  type FieldDefinition,
  findMissingRequiredFields,
  ImportProfileMismatchError,
} from './default-aliases';
import {
  buildVisualRows,
  ROW_Y_TOLERANCE,
  type PositionedItem,
  type VisualRow,
} from './pdf-extract';
import {
  FOOTER_NOISE_RE,
  normalizeToken,
  parseAmountToken,
  parseDate,
  TOKEN_DATE_MONABBR_RE,
  TOKEN_INDEX_RE,
  TOKEN_MONEY_RE,
  TOKEN_RECEIPT_RE,
  TOKEN_TIME_RE,
} from './pdf-tokens';

// ---------------------------------------------------------------------------
// Positional table reconstruction. Each page repeats the header; a transaction
// is anchored by a row carrying a date token in the Fecha column, and wrapped
// multi-line descriptions on neighbouring rows attach to their nearest anchor.
// ---------------------------------------------------------------------------

type ColumnCenters = Partial<Record<string, number>>;

interface HeaderDetection {
  headerRow: VisualRow;
  centers: ColumnCenters;
}

/**
 * Resolve a single header CELL to a field key by EXACT alias match. Positional
 * headers are one token per cell ("Fecha", "Cargos"), so exact matching is both
 * correct and necessary: the loose substring matcher used for line-based text
 * would mis-read metadata cells like "Cargos Totales" or "Número Cliente" as
 * column headers.
 */
function matchHeaderCellExact(
  cell: string,
  aliasIndex: { key: string; normalizedAliases: string[] }[],
): string | null {
  const norm = normalizeToken(cell);
  if (!norm) return null;
  for (const entry of aliasIndex) {
    if (entry.normalizedAliases.includes(norm)) return entry.key;
  }
  return null;
}

/**
 * Find the table header row and the x-center of each mapped column. A real
 * transaction header carries the full system-field quad (date + charges +
 * credits + balance); the statement metadata block does not, so requiring all
 * four reliably excludes spurious metadata rows.
 */
function detectHeader(
  rows: VisualRow[],
  aliasIndex: { key: string; normalizedAliases: string[] }[],
): HeaderDetection | null {
  for (const row of rows) {
    const centers: ColumnCenters = {};
    let matched = 0;
    for (const it of row.items) {
      const key = matchHeaderCellExact(it.str, aliasIndex);
      if (key && centers[key] === undefined) {
        centers[key] = it.x;
        matched++;
      }
    }
    if (
      matched >= 3 &&
      centers.date !== undefined &&
      centers.charges !== undefined &&
      centers.credits !== undefined &&
      centers.balance !== undefined
    ) {
      return { headerRow: row, centers };
    }
  }
  return null;
}

/** Assign an amount token to charges/credits/balance by nearest column center. */
function nearestMoneyKey(
  x: number,
  centers: ColumnCenters,
): 'charges' | 'credits' | 'balance' {
  const candidates: Array<['charges' | 'credits' | 'balance', number | undefined]> = [
    ['charges', centers.charges],
    ['credits', centers.credits],
    ['balance', centers.balance],
  ];
  let best: 'charges' | 'credits' | 'balance' = 'balance';
  let bestDist = Infinity;
  for (const [key, center] of candidates) {
    if (center === undefined) continue;
    const dist = Math.abs(x - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }
  return best;
}

function nearestColumnKey(x: number, centers: ColumnCenters): string | null {
  let bestKey: string | null = null;
  let bestDist = Infinity;
  for (const [key, center] of Object.entries(centers)) {
    if (center === undefined) continue;
    const dist = Math.abs(x - center);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = key;
    }
  }
  return bestKey;
}

export interface PositionalParseOutcome {
  transactions: ParsedRow[];
  matched: boolean;
}

/** Reconstruct transactions from the positional table on every page. */
export function parsePositional(
  pages: PositionedItem[][],
  aliasIndex: { key: string; normalizedAliases: string[] }[],
  fields: FieldDefinition[],
): PositionalParseOutcome {
  const transactions: ParsedRow[] = [];
  let anyHeaderFound = false;
  let mismatchError: ImportProfileMismatchError | null = null;

  for (const pageItems of pages) {
    const rows = buildVisualRows(pageItems);
    const header = detectHeader(rows, aliasIndex);
    if (!header) continue;
    anyHeaderFound = true;
    const { centers } = header;

    const missing = findMissingRequiredFields(fields, new Set(Object.keys(centers)));
    if (missing.length > 0 && !mismatchError) {
      mismatchError = new ImportProfileMismatchError(
        missing,
        header.headerRow.items.map((i) => i.str),
      );
      continue;
    }

    const dataRows = rows.filter((r) => r.y > header.headerRow.y + ROW_Y_TOLERANCE);

    // Anchors: a row whose date token's nearest column is `date`.
    const anchors: Array<{ row: VisualRow; dateItem: PositionedItem }> = [];
    for (const row of dataRows) {
      const dateItem = row.items.find(
        (it) =>
          (TOKEN_DATE_MONABBR_RE.test(it.str) || parseDate(it.str) !== null) &&
          nearestColumnKey(it.x, centers) === 'date',
      );
      if (dateItem) anchors.push({ row, dateItem });
    }
    if (anchors.length === 0) continue;

    // Group every data row (anchor + wrapped-description lines) to its record.
    const recordItems: PositionedItem[][] = anchors.map(() => []);
    const anchorRowSet = new Set(anchors.map((a) => a.row));
    for (const row of dataRows) {
      let idx: number;
      if (anchorRowSet.has(row)) {
        idx = anchors.findIndex((a) => a.row === row);
      } else {
        idx = 0;
        let bestDist = Infinity;
        anchors.forEach((a, i) => {
          const dist = Math.abs(a.row.y - row.y);
          if (dist < bestDist) {
            bestDist = dist;
            idx = i;
          }
        });
      }
      recordItems[idx].push(...row.items);
    }

    // Description column band: between the rightmost left-side column and the
    // leftmost money column. The description BODY text is left-aligned under a
    // centered header, so we bound by neighbouring column centers, not by the
    // description header center.
    const leftBound = Math.max(
      centers.date ?? -Infinity,
      centers.time ?? -Infinity,
      centers.receipt ?? -Infinity,
    );
    const rightBound = Math.min(
      centers.charges ?? Infinity,
      centers.credits ?? Infinity,
      centers.balance ?? Infinity,
    );

    anchors.forEach((anchor, i) => {
      const date = parseDate(anchor.dateItem.str);
      if (!date) return;

      let time: string | undefined;
      let receipt: string | undefined;
      let transactionNumber: string | undefined;
      let charges = 0;
      let credits = 0;
      let balance = 0;
      const parseIssues: NonNullable<ParsedRow['parseIssues']> = [];
      const descParts: PositionedItem[] = [];

      for (const it of recordItems[i]) {
        if (it === anchor.dateItem) continue;
        const s = it.str;
        if (TOKEN_TIME_RE.test(s)) {
          if (!time) time = s;
          continue;
        }
        if (TOKEN_MONEY_RE.test(s)) {
          const key = nearestMoneyKey(it.x, centers);
          const { value, issue } = parseAmountToken(s);
          if (issue) {
            parseIssues.push({ field: key, issue, raw: s });
          } else if (key === 'charges') charges = value;
          else if (key === 'credits') credits = value;
          else balance = value;
          continue;
        }
        if (TOKEN_RECEIPT_RE.test(s)) {
          if (!receipt) receipt = s;
          continue;
        }
        if (TOKEN_INDEX_RE.test(s) && centers.date !== undefined && it.x < centers.date) {
          if (!transactionNumber) transactionNumber = s;
          continue;
        }
        // Description: inside the column band and not statement footer noise.
        if (it.x > leftBound && it.x < rightBound && !FOOTER_NOISE_RE.test(s)) {
          descParts.push(it);
        }
      }

      descParts.sort((a, b) => a.y - b.y || a.x - b.x);
      const description = descParts
        .map((d) => d.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      transactions.push({
        date,
        description,
        charges,
        credits,
        balance,
        flowType: credits > 0 ? 'income' : 'expense',
        ...(transactionNumber ? { transactionNumber } : {}),
        ...(time ? { time } : {}),
        ...(receipt ? { receipt } : {}),
        ...(parseIssues.length > 0 ? { parseIssues } : {}),
      });
    });
  }

  // A profile mismatch is only authoritative when we never managed to parse any
  // rows under any page header.
  if (mismatchError && transactions.length === 0) throw mismatchError;

  return { transactions, matched: anyHeaderFound && transactions.length > 0 };
}
