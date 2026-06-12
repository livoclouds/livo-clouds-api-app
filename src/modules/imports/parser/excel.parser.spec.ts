import * as ExcelJS from 'exceljs';
import { parseExcelBuffer } from './excel.parser';

async function buildSampleWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.addRow(['Fecha', 'Descripción', 'Cargo', 'Abono', 'Saldo']);
  sheet.addRow([new Date(Date.UTC(2026, 2, 6)), 'Pago de cuota Depto 101', 0, 2500, 12500]);
  sheet.addRow([new Date(Date.UTC(2026, 2, 7)), 'Compra papelería', 350, 0, 12150]);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

describe('parseExcelBuffer', () => {
  it('binds ExcelJS as a namespace import (regression for `Workbook is undefined`)', () => {
    expect(typeof ExcelJS.Workbook).toBe('function');
    expect(() => new ExcelJS.Workbook()).not.toThrow();
  });

  it('extracts transactions from a minimal Spanish-header workbook', async () => {
    const buffer = await buildSampleWorkbookBuffer();
    const result = await parseExcelBuffer(buffer);
    expect(result.transactions).toHaveLength(2);
    const [first, second] = result.transactions;
    expect(first.date).toBe('2026-03-06');
    expect(first.credits).toBe(2500);
    expect(first.flowType).toBe('income');
    expect(second.charges).toBe(350);
    expect(second.flowType).toBe('expense');
  });
});

/**
 * ENGINE-029/030 — amount-parsing safety. Text amounts either parse under the
 * US/MX convention or the row is FLAGGED (NaN + parseIssues), never guessed.
 */
describe('parseExcelBuffer — amount conventions (ENGINE-029/030)', () => {
  async function parseAmountColumn(cells: Array<string | number>) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Movimientos');
    sheet.addRow(['Fecha', 'Descripción', 'Cargo', 'Abono', 'Saldo']);
    cells.forEach((cell, i) => {
      sheet.addRow([`0${i + 1}/03/2026`, `ROW ${i + 1}`, '', cell, 1000]);
    });
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return parseExcelBuffer(Buffer.from(arrayBuffer as ArrayBuffer));
  }

  it('parses US/MX-convention text amounts exactly', async () => {
    const { transactions } = await parseAmountColumn([
      '1,234.56',
      '$ 2,000.00',
      '1234.5',
      '987',
    ]);
    expect(transactions.map((t) => t.credits)).toEqual([1234.56, 2000, 1234.5, 987]);
    expect(transactions.every((t) => t.parseIssues === undefined)).toBe(true);
  });

  it('parses parenthesized negatives and stores the absolute value', async () => {
    const { transactions } = await parseAmountColumn(['(1,234.56)']);
    expect(transactions[0].credits).toBe(1234.56);
    expect(transactions[0].parseIssues).toBeUndefined();
  });

  it("flags European-format '1.234,56' as ambiguousDecimal — NEVER 1.23 (ENGINE-029)", async () => {
    const { transactions } = await parseAmountColumn(['1.234,56', '1234,56']);
    for (const tx of transactions) {
      expect(tx.credits).toBeNaN();
      expect(tx.parseIssues).toEqual([
        expect.objectContaining({ field: 'credits', issue: 'ambiguousDecimal' }),
      ]);
    }
  });

  it('flags non-numeric text as unparseable — NEVER $0.00 (ENGINE-030)', async () => {
    const { transactions } = await parseAmountColumn(['abc', '12..34']);
    for (const tx of transactions) {
      expect(tx.credits).toBeNaN();
      expect(tx.parseIssues).toEqual([
        expect.objectContaining({ field: 'credits', issue: 'unparseable' }),
      ]);
    }
  });

  it('keeps empty cells legal as 0 and numeric cells on the fast path', async () => {
    const { transactions } = await parseAmountColumn(['', 1500.75]);
    expect(transactions[0].credits).toBe(0);
    expect(transactions[0].parseIssues).toBeUndefined();
    expect(transactions[1].credits).toBe(1500.75);
    expect(transactions[1].parseIssues).toBeUndefined();
  });
});
