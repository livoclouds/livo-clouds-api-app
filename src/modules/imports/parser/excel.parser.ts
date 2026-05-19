import ExcelJS from 'exceljs';
import type { ParsedRow } from './types';
import {
  buildAliasIndex,
  DEFAULT_FIELD_DEFINITIONS,
  type FieldDefinition,
  findMissingRequiredFields,
  ImportProfileMismatchError,
  matchHeaderToFieldKey,
} from './default-aliases';

const MONTH_ALIASES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
};

function cellText(cell: ExcelJS.Cell): string {
  if (cell.value === null || cell.value === undefined) return '';
  if (typeof cell.value === 'object' && 'richText' in cell.value) {
    return (cell.value as ExcelJS.CellRichTextValue).richText
      .map((r) => r.text)
      .join('');
  }
  if (typeof cell.value === 'object' && 'formula' in cell.value) {
    const formulaCell = cell.value as ExcelJS.CellFormulaValue;
    return formulaCell.result !== undefined ? String(formulaCell.result) : '';
  }
  return String(cell.value);
}


function parseTextDate(raw: string): Date | null {
  const s = raw.trim();

  const spanishLong = s.match(/^(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})$/i);
  if (spanishLong) {
    const month = MONTH_ALIASES[spanishLong[2].toLowerCase()];
    if (month) return new Date(Date.UTC(+spanishLong[3], month - 1, +spanishLong[1]));
  }

  const dashMonth = s.match(/^(\d{1,2})[/-]([A-Za-záéíóúñ]+)[/-](\d{4})$/i);
  if (dashMonth) {
    const month = MONTH_ALIASES[dashMonth[2].toLowerCase()];
    if (month) return new Date(Date.UTC(+dashMonth[3], month - 1, +dashMonth[1]));
  }

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  return null;
}

function parseDateCell(cell: ExcelJS.Cell): Date | null {
  if (cell.value instanceof Date) return cell.value;
  if (typeof cell.value === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + cell.value * 86400000);
  }
  const text = cellText(cell);
  if (!text) return null;
  return parseTextDate(text);
}

function parseTimeCell(cell: ExcelJS.Cell): string | undefined {
  if (cell.value instanceof Date) {
    const h = String(cell.value.getUTCHours()).padStart(2, '0');
    const m = String(cell.value.getUTCMinutes()).padStart(2, '0');
    const s = String(cell.value.getUTCSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  if (typeof cell.value === 'number' && cell.value >= 0 && cell.value < 1) {
    const total = Math.round(cell.value * 86400);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const text = cellText(cell);
  if (!text) return undefined;
  const match = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return `${String(+match[1]).padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`;
  }
  return text || undefined;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/\$\s*/g, '').replace(/,/g, '').trim();
  const isNegative = cleaned.startsWith('(') && cleaned.endsWith(')');
  const numeric = parseFloat(cleaned.replace(/[()]/g, ''));
  if (isNaN(numeric)) return 0;
  return isNegative ? -numeric : numeric;
}

function parseAmountCell(cell: ExcelJS.Cell): number {
  if (typeof cell.value === 'number') return cell.value;
  return parseAmount(cellText(cell));
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface ExcelParseResult {
  transactions: ParsedRow[];
  warnings: string[];
}

export interface ExcelParseOptions {
  fields?: FieldDefinition[];
}

export async function parseExcelBuffer(
  buffer: Buffer,
  options: ExcelParseOptions = {},
): Promise<ExcelParseResult> {
  const fields = options.fields && options.fields.length > 0
    ? options.fields
    : DEFAULT_FIELD_DEFINITIONS;
  const aliasIndex = buildAliasIndex(fields);

  const warnings: string[] = [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { transactions: [], warnings: ['No worksheet found in file.'] };
  }

  let headerRowIndex = -1;
  const columnMap: Record<string, number> = {};
  let detectedHeaders: string[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowIndex) => {
    if (headerRowIndex !== -1) return;
    let matches = 0;
    const candidateMap: Record<string, number> = {};
    const candidateHeaders: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, colIndex) => {
      const text = cellText(cell);
      if (text) candidateHeaders.push(text);
      const key = matchHeaderToFieldKey(text, aliasIndex);
      if (key) {
        matches++;
        if (!candidateMap[key]) candidateMap[key] = colIndex;
      }
    });
    if (matches >= 4) {
      headerRowIndex = rowIndex;
      Object.assign(columnMap, candidateMap);
      detectedHeaders = candidateHeaders;
    }
  });

  if (headerRowIndex === -1) {
    return {
      transactions: [],
      warnings: [
        'Could not detect header row. Ensure the file has columns matching the active bank profile.',
      ],
    };
  }

  const resolvedKeys = new Set(Object.keys(columnMap));
  const missing = findMissingRequiredFields(fields, resolvedKeys);
  if (missing.length > 0) {
    throw new ImportProfileMismatchError(missing, detectedHeaders);
  }

  const transactions: ParsedRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowIndex) => {
    if (rowIndex <= headerRowIndex) return;

    const dateCell = columnMap['date'] ? row.getCell(columnMap['date']) : null;
    if (!dateCell) return;

    const parsedDate = parseDateCell(dateCell);
    if (!parsedDate) return;

    const charges = columnMap['charges']
      ? parseAmountCell(row.getCell(columnMap['charges']))
      : 0;
    const credits = columnMap['credits']
      ? parseAmountCell(row.getCell(columnMap['credits']))
      : 0;
    const balance = columnMap['balance']
      ? parseAmountCell(row.getCell(columnMap['balance']))
      : 0;
    const description = columnMap['description']
      ? cellText(row.getCell(columnMap['description']))
      : '';
    const time = columnMap['time']
      ? parseTimeCell(row.getCell(columnMap['time']))
      : undefined;
    const receipt = columnMap['receipt']
      ? cellText(row.getCell(columnMap['receipt']))
      : undefined;
    const transactionNumber = columnMap['transactionNumber']
      ? cellText(row.getCell(columnMap['transactionNumber']))
      : undefined;

    if (!description && charges === 0 && credits === 0) return;

    const absCharges = Math.abs(charges);
    const absCredits = Math.abs(credits);

    transactions.push({
      transactionNumber: transactionNumber || undefined,
      date: toIsoDate(parsedDate),
      time: time || undefined,
      receipt: receipt || undefined,
      description,
      charges: absCharges,
      credits: absCredits,
      balance,
      flowType: absCredits > 0 ? 'income' : 'expense',
    });
  });

  if (transactions.length === 0) {
    warnings.push(
      'No transactions could be extracted. Verify the file has data rows below the header.',
    );
  }

  return { transactions, warnings };
}
