import * as ExcelJS from 'exceljs';
import type { AmountIssue, AmountParseIssue, ParsedRow } from './types';
import { round2 } from '../../../common/utils/money.util';
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

// US/MX convention: optional thousands commas, dot decimals ("1,234.56", "1234.5").
const US_AMOUNT_RE = /^(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/;
// European convention: dot thousands and/or comma decimals ("1.234,56", "1234,56").
// Ambiguous with the US format at parse time — never guess (ENGINE-029).
const EURO_AMOUNT_RE = /^(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2})$/;

interface AmountParseResult {
  value: number;
  issue?: AmountIssue;
}

/**
 * ENGINE-029/030 — parse a text amount or refuse loudly.
 * The old implementation stripped ALL commas then parseFloat'ed, silently
 * turning `1.234,56` into 1.23, and coerced unparseable text to $0.00.
 * Refusals return NaN + an issue marker; validateRows rejects the row.
 */
function parseAmount(raw: string): AmountParseResult {
  if (!raw) return { value: 0 };
  const stripped = raw.replace(/\$\s*/g, '').trim();
  const isNegative = stripped.startsWith('(') && stripped.endsWith(')');
  const bare = stripped.replace(/[()]/g, '').replace(/^-/, '').trim();
  const sign = isNegative || stripped.startsWith('-') ? -1 : 1;

  if (!bare) return { value: 0 };

  if (US_AMOUNT_RE.test(bare)) {
    return { value: sign * parseFloat(bare.replace(/,/g, '')) };
  }
  if (EURO_AMOUNT_RE.test(bare)) {
    return { value: NaN, issue: 'ambiguousDecimal' };
  }
  return { value: NaN, issue: 'unparseable' };
}

function parseAmountCell(cell: ExcelJS.Cell): AmountParseResult {
  if (typeof cell.value === 'number') return { value: cell.value };
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

    const chargesResult = columnMap['charges']
      ? parseAmountCell(row.getCell(columnMap['charges']))
      : { value: 0 };
    const creditsResult = columnMap['credits']
      ? parseAmountCell(row.getCell(columnMap['credits']))
      : { value: 0 };
    const balanceResult = columnMap['balance']
      ? parseAmountCell(row.getCell(columnMap['balance']))
      : { value: 0 };
    const charges = chargesResult.value;
    const credits = creditsResult.value;
    const balance = balanceResult.value;

    const parseIssues: AmountParseIssue[] = [];
    const collectIssue = (
      field: AmountParseIssue['field'],
      result: AmountParseResult,
      column: string | undefined,
    ): void => {
      if (result.issue && column) {
        parseIssues.push({
          field,
          issue: result.issue,
          raw: cellText(row.getCell(columnMap[column])),
        });
      }
    };
    collectIssue('charges', chargesResult, 'charges');
    collectIssue('credits', creditsResult, 'credits');
    collectIssue('balance', balanceResult, 'balance');

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

    if (
      !description &&
      charges === 0 &&
      credits === 0 &&
      parseIssues.length === 0
    ) {
      return;
    }

    // NaN flows through Math.abs and round2 untouched — the row carries its
    // parseIssues and validateRows rejects it with a precise reason.
    const absCharges = round2(Math.abs(charges));
    const absCredits = round2(Math.abs(credits));

    transactions.push({
      transactionNumber: transactionNumber || undefined,
      date: toIsoDate(parsedDate),
      time: time || undefined,
      receipt: receipt || undefined,
      description,
      charges: absCharges,
      credits: absCredits,
      balance: round2(balance),
      flowType: absCredits > 0 ? 'income' : 'expense',
      ...(parseIssues.length > 0 && { parseIssues }),
    });
  });

  if (transactions.length === 0) {
    warnings.push(
      'No transactions could be extracted. Verify the file has data rows below the header.',
    );
  }

  return { transactions, warnings };
}
