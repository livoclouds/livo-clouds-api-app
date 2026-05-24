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
