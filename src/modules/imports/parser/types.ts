// ENGINE-029/030 — a money cell the parser refused to guess about. The value
// stays NaN (never silently 0) and validateRows turns the issue into a row
// error, so the row is rejected with a visible reason instead of importing
// corrupted amounts.
export type AmountIssue = 'ambiguousDecimal' | 'unparseable';

export interface AmountParseIssue {
  field: 'charges' | 'credits' | 'balance';
  issue: AmountIssue;
  raw: string;
}

export interface ParsedRow {
  date: string;
  description: string;
  charges: number;
  credits: number;
  balance: number;
  flowType: 'income' | 'expense';
  transactionNumber?: string;
  time?: string;
  receipt?: string;
  parseIssues?: AmountParseIssue[];
}

export interface DetectedPeriod {
  month: number;
  year: number;
  monthName: string;
  dayStart: number;
  dayEnd: number;
}

const MONTH_NAMES_ES: Record<number, string> = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};

// ENGINE-026 — the single finalBalance authority shared by preview and
// confirm. Semantics: the balance of the chronologically latest row; equal
// dates are broken by the LATEST array index, because banks list intra-day
// movements in file order, so the last row of the latest day carries the
// closing balance. Empty input yields 0.
export function computeFinalBalance(
  rows: Array<Pick<ParsedRow, 'date' | 'balance'>>,
): number {
  let best: { time: number; balance: number } | null = null;
  for (const row of rows) {
    const time = new Date(row.date).getTime();
    if (Number.isNaN(time)) continue;
    if (!best || time >= best.time) {
      best = { time, balance: row.balance };
    }
  }
  return best?.balance ?? 0;
}

export function buildPeriods(transactions: ParsedRow[]): DetectedPeriod[] {
  const map = new Map<string, DetectedPeriod>();
  for (const tx of transactions) {
    const d = new Date(tx.date);
    if (isNaN(d.getTime())) continue;
    const month = d.getUTCMonth() + 1;
    const year = d.getUTCFullYear();
    const day = d.getUTCDate();
    const key = `${year}-${month}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        month,
        year,
        monthName: MONTH_NAMES_ES[month] ?? String(month),
        dayStart: day,
        dayEnd: day,
      });
    } else {
      existing.dayStart = Math.min(existing.dayStart, day);
      existing.dayEnd = Math.max(existing.dayEnd, day);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
}
