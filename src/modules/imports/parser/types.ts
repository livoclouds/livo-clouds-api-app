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
