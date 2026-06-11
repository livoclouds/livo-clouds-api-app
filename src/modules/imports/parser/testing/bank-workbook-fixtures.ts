/**
 * Golden in-memory workbook fixtures for the Excel statement parser
 * (audit finding ENGINE-032).
 *
 * Each builder produces an `.xlsx` Buffer entirely in memory (no binary files
 * checked in) and is paired with an `EXPECTED_*` constant pinning the EXACT
 * `ParsedRow[]` the parser must produce for that workbook. The constants are
 * golden: they lock today's parser behavior so any future change to header
 * detection, alias matching, date parsing, or amount parsing is caught by a
 * deep-equality diff.
 *
 * This module is intentionally free of Jest globals so integration tests can
 * import the builders directly.
 */
import * as ExcelJS from 'exceljs';
import type { ParsedRow } from '../types';

async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/* ------------------------------------------------------------------------ *
 * 1. Default layout — canonical Spanish headers
 *    Fecha / Descripción / Cargos / Abonos / Saldo, native Date cells,
 *    numeric amount cells. The happy path most Mexican bank exports follow.
 * ------------------------------------------------------------------------ */

export async function buildDefaultLayoutWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.addRow(['Fecha', 'Descripción', 'Cargos', 'Abonos', 'Saldo']);
  sheet.addRow([
    new Date(Date.UTC(2025, 10, 3)),
    'TRANSFERENCIA SPEI PAGO MANTENIMIENTO CASA 12',
    0,
    2500,
    152500,
  ]);
  sheet.addRow([
    new Date(Date.UTC(2025, 10, 5)),
    'PAGO SERVICIO CFE SUMINISTRO AREAS COMUNES',
    3480.5,
    0,
    149019.5,
  ]);
  sheet.addRow([
    new Date(Date.UTC(2025, 10, 10)),
    'DEPOSITO EFECTIVO CUOTA MANTENIMIENTO CASA 7',
    0,
    2500,
    151519.5,
  ]);
  sheet.addRow([
    new Date(Date.UTC(2025, 10, 12)),
    'TRANSFERENCIA SPEI JARDINERIA NOVIEMBRE',
    4200,
    0,
    147319.5,
  ]);
  sheet.addRow([
    new Date(Date.UTC(2025, 10, 18)),
    'SPEI RECIBIDO PAGO CUOTA EXTRAORDINARIA CASA 21',
    0,
    1200,
    148519.5,
  ]);
  sheet.addRow([
    new Date(Date.UTC(2025, 10, 25)),
    'COMISION MANEJO DE CUENTA',
    58,
    0,
    148461.5,
  ]);
  return workbookToBuffer(workbook);
}

export const EXPECTED_DEFAULT_LAYOUT: ParsedRow[] = [
  {
    date: '2025-11-03',
    description: 'TRANSFERENCIA SPEI PAGO MANTENIMIENTO CASA 12',
    charges: 0,
    credits: 2500,
    balance: 152500,
    flowType: 'income',
  },
  {
    date: '2025-11-05',
    description: 'PAGO SERVICIO CFE SUMINISTRO AREAS COMUNES',
    charges: 3480.5,
    credits: 0,
    balance: 149019.5,
    flowType: 'expense',
  },
  {
    date: '2025-11-10',
    description: 'DEPOSITO EFECTIVO CUOTA MANTENIMIENTO CASA 7',
    charges: 0,
    credits: 2500,
    balance: 151519.5,
    flowType: 'income',
  },
  {
    date: '2025-11-12',
    description: 'TRANSFERENCIA SPEI JARDINERIA NOVIEMBRE',
    charges: 4200,
    credits: 0,
    balance: 147319.5,
    flowType: 'expense',
  },
  {
    date: '2025-11-18',
    description: 'SPEI RECIBIDO PAGO CUOTA EXTRAORDINARIA CASA 21',
    charges: 0,
    credits: 1200,
    balance: 148519.5,
    flowType: 'income',
  },
  {
    date: '2025-11-25',
    description: 'COMISION MANEJO DE CUENTA',
    charges: 58,
    credits: 0,
    balance: 148461.5,
    flowType: 'expense',
  },
];

/* ------------------------------------------------------------------------ *
 * 2. BanBajío-style layout — junk title rows above the header, Concepto as
 *    the description column, and `DD/MON/YYYY` text dates. BanBajío's
 *    special-casing lives in classification (unit-number extraction), NOT in
 *    parsing — this fixture documents the raw layout that reaches the parser
 *    and its concept style ('CASAS 307 Y 43', 'CASA 0034 MTTO ...').
 * ------------------------------------------------------------------------ */

export async function buildBanBajioWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Estado de Cuenta');
  // Junk rows above the header: fewer than 4 alias matches, so the header
  // detector must skip them.
  sheet.addRow(['BANCO DEL BAJIO, S.A. INSTITUCION DE BANCA MULTIPLE']);
  sheet.addRow(['ESTADO DE CUENTA PERIODO 01/NOV/2025 AL 30/NOV/2025']);
  sheet.addRow(['Fecha', 'Concepto', 'Cargos', 'Abonos', 'Saldo']);
  sheet.addRow(['03/NOV/2025', 'TRASPASO ENTRE CUENTAS CASAS 307 Y 43', 0, 5000, 85000]);
  sheet.addRow(['07/NOV/2025', 'DEPOSITO CASA 0034 MTTO NOVIEMBRE 2025', 0, 2500, 87500]);
  sheet.addRow(['15/NOV/2025', 'CHEQUE PAGADO 0000123 MANTENIMIENTO ALBERCA', 7800, 0, 79700]);
  sheet.addRow(['28/NOV/2025', 'COM MEMBRESIA BEM', 250, 0, 79450]);
  return workbookToBuffer(workbook);
}

export const EXPECTED_BANBAJIO: ParsedRow[] = [
  {
    date: '2025-11-03',
    description: 'TRASPASO ENTRE CUENTAS CASAS 307 Y 43',
    charges: 0,
    credits: 5000,
    balance: 85000,
    flowType: 'income',
  },
  {
    date: '2025-11-07',
    description: 'DEPOSITO CASA 0034 MTTO NOVIEMBRE 2025',
    charges: 0,
    credits: 2500,
    balance: 87500,
    flowType: 'income',
  },
  {
    date: '2025-11-15',
    description: 'CHEQUE PAGADO 0000123 MANTENIMIENTO ALBERCA',
    charges: 7800,
    credits: 0,
    balance: 79700,
    flowType: 'expense',
  },
  {
    date: '2025-11-28',
    description: 'COM MEMBRESIA BEM',
    charges: 250,
    credits: 0,
    balance: 79450,
    flowType: 'expense',
  },
];

/* ------------------------------------------------------------------------ *
 * 3. Retiros/Depósitos alias family — Fecha / Concepto / Retiros /
 *    Depósitos / Saldo with `DD/MM/YYYY` text dates.
 * ------------------------------------------------------------------------ */

export async function buildRetirosDepositosWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.addRow(['Fecha', 'Concepto', 'Retiros', 'Depósitos', 'Saldo']);
  sheet.addRow(['02/10/2025', 'SPEI RECIBIDO CUOTA MTTO CASA 18', 0, 2500, 64500]);
  sheet.addRow(['09/10/2025', 'RETIRO CAJERO AUTOMATICO FONDO FESTEJOS', 1500, 0, 63000]);
  sheet.addRow(['17/10/2025', 'DEPOSITO EN EFECTIVO CUOTA CASA 25', 0, 2500, 65500]);
  sheet.addRow(['28/10/2025', 'PAGO RECOLECCION BASURA OCTUBRE', 1800, 0, 63700]);
  return workbookToBuffer(workbook);
}

export const EXPECTED_RETIROS_DEPOSITOS: ParsedRow[] = [
  {
    date: '2025-10-02',
    description: 'SPEI RECIBIDO CUOTA MTTO CASA 18',
    charges: 0,
    credits: 2500,
    balance: 64500,
    flowType: 'income',
  },
  {
    date: '2025-10-09',
    description: 'RETIRO CAJERO AUTOMATICO FONDO FESTEJOS',
    charges: 1500,
    credits: 0,
    balance: 63000,
    flowType: 'expense',
  },
  {
    date: '2025-10-17',
    description: 'DEPOSITO EN EFECTIVO CUOTA CASA 25',
    charges: 0,
    credits: 2500,
    balance: 65500,
    flowType: 'income',
  },
  {
    date: '2025-10-28',
    description: 'PAGO RECOLECCION BASURA OCTUBRE',
    charges: 1800,
    credits: 0,
    balance: 63700,
    flowType: 'expense',
  },
];

/* ------------------------------------------------------------------------ *
 * 4. Débito/Crédito alias family — Fecha Operación / Concepto / Débito /
 *    Crédito / Saldo with native Date cells. 'Fecha Operación' resolves to
 *    `date` because alias matching is substring-based ('fecha' ⊂ header).
 * ------------------------------------------------------------------------ */

export async function buildDebitoCreditoWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.addRow(['Fecha Operación', 'Concepto', 'Débito', 'Crédito', 'Saldo']);
  sheet.addRow([
    new Date(Date.UTC(2025, 8, 1)),
    'CREDITO SPEI CUOTA MANTENIMIENTO CASA 5',
    0,
    2500,
    42500,
  ]);
  sheet.addRow([
    new Date(Date.UTC(2025, 8, 8)),
    'DEBITO PAGO BOMBA DE AGUA REFACCION',
    6750,
    0,
    35750,
  ]);
  sheet.addRow([
    new Date(Date.UTC(2025, 8, 15)),
    'CREDITO TRANSFERENCIA CUOTA CASA 9',
    0,
    2500,
    38250,
  ]);
  sheet.addRow([
    new Date(Date.UTC(2025, 8, 30)),
    'DEBITO COMISION MANEJO DE CUENTA',
    174,
    0,
    38076,
  ]);
  return workbookToBuffer(workbook);
}

export const EXPECTED_DEBITO_CREDITO: ParsedRow[] = [
  {
    date: '2025-09-01',
    description: 'CREDITO SPEI CUOTA MANTENIMIENTO CASA 5',
    charges: 0,
    credits: 2500,
    balance: 42500,
    flowType: 'income',
  },
  {
    date: '2025-09-08',
    description: 'DEBITO PAGO BOMBA DE AGUA REFACCION',
    charges: 6750,
    credits: 0,
    balance: 35750,
    flowType: 'expense',
  },
  {
    date: '2025-09-15',
    description: 'CREDITO TRANSFERENCIA CUOTA CASA 9',
    charges: 0,
    credits: 2500,
    balance: 38250,
    flowType: 'income',
  },
  {
    date: '2025-09-30',
    description: 'DEBITO COMISION MANEJO DE CUENTA',
    charges: 174,
    credits: 0,
    balance: 38076,
    flowType: 'expense',
  },
];

/* ------------------------------------------------------------------------ *
 * 5. English alias family — Date / Description / Charges / Credits /
 *    Balance with ISO `YYYY-MM-DD` text dates.
 * ------------------------------------------------------------------------ */

export async function buildEnglishLayoutWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Statement');
  sheet.addRow(['Date', 'Description', 'Charges', 'Credits', 'Balance']);
  sheet.addRow(['2025-08-04', 'HOA FEE PAYMENT UNIT 14', 0, 2300, 30300]);
  sheet.addRow(['2025-08-11', 'POOL MAINTENANCE SERVICE', 1950, 0, 28350]);
  sheet.addRow(['2025-08-22', 'WIRE TRANSFER HOA FEE UNIT 3', 0, 2300, 30650]);
  return workbookToBuffer(workbook);
}

export const EXPECTED_ENGLISH_LAYOUT: ParsedRow[] = [
  {
    date: '2025-08-04',
    description: 'HOA FEE PAYMENT UNIT 14',
    charges: 0,
    credits: 2300,
    balance: 30300,
    flowType: 'income',
  },
  {
    date: '2025-08-11',
    description: 'POOL MAINTENANCE SERVICE',
    charges: 1950,
    credits: 0,
    balance: 28350,
    flowType: 'expense',
  },
  {
    date: '2025-08-22',
    description: 'WIRE TRANSFER HOA FEE UNIT 3',
    charges: 0,
    credits: 2300,
    balance: 30650,
    flowType: 'income',
  },
];

/* ------------------------------------------------------------------------ *
 * 6. Hostile cells — exercises the parser's defensive paths and pins the
 *    exact survivors:
 *    - Headers in upper case, accent-free, with stray whitespace (the
 *      normalizer lowercases, trims, and strips diacritics).
 *    - Currency-formatted TEXT amounts: '$1,234.56' and '$ 2,000.00'.
 *    - Parenthesized negative '(350.00)' → -350, then |·| → charges 350.
 *    - Fully blank rows interleaved (skipped by `includeEmpty: false`).
 *    - A row whose date cell is 'N/A' → dropped SILENTLY (no warning).
 *    - A row with a valid date but empty description and zero amounts →
 *      dropped silently even though balance is non-zero.
 *    - A non-numeric amount 'abc' → parsed as 0.
 *    - An Excel serial-number date (45968 → 2025-11-07).
 *    - A Spanish long date '8 de noviembre de 2025'.
 *    Warnings stay EMPTY: the parser only warns when zero transactions
 *    are extracted overall.
 * ------------------------------------------------------------------------ */

/** Excel serial date for 2025-11-07 (days since 1899-12-30). */
export const HOSTILE_SERIAL_DATE = 45968;

export async function buildHostileCellsWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.addRow(['  FECHA  ', 'DESCRIPCION', 'CARGOS', 'ABONOS', 'SALDO']);
  sheet.addRow(['05/11/2025', 'PAGO MANTENIMIENTO CASA 3', '', '$1,234.56', '$151,234.56']);
  sheet.addRow([]); // fully blank row — skipped by includeEmpty: false
  sheet.addRow(['06/11/2025', 'REEMBOLSO CAJA CHICA', '(350.00)', '', '$150,884.56']);
  sheet.addRow([null, null, null, null, null]); // null-celled row — also skipped
  sheet.addRow(['N/A', 'FILA CON FECHA INVALIDA', '100', '', '100']); // dropped: unparseable date
  sheet.addRow(['07/11/2025', '', '', '', '$150,884.56']); // dropped: empty desc + zero amounts
  sheet.addRow([
    HOSTILE_SERIAL_DATE,
    'CUOTA EXTRAORDINARIA CASA 21',
    'abc',
    '$ 2,000.00',
    152884.56,
  ]);
  sheet.addRow(['8 de noviembre de 2025', 'PAGO VIGILANCIA NOVIEMBRE', '12,500.00', '', '140,384.56']);
  return workbookToBuffer(workbook);
}

export const EXPECTED_HOSTILE_CELLS: ParsedRow[] = [
  {
    date: '2025-11-05',
    description: 'PAGO MANTENIMIENTO CASA 3',
    charges: 0,
    credits: 1234.56,
    balance: 151234.56,
    flowType: 'income',
  },
  {
    date: '2025-11-06',
    description: 'REEMBOLSO CAJA CHICA',
    charges: 350, // '(350.00)' → -350 → absolute value
    credits: 0,
    balance: 150884.56,
    flowType: 'expense',
  },
  {
    date: '2025-11-07', // serial 45968
    description: 'CUOTA EXTRAORDINARIA CASA 21',
    charges: 0, // 'abc' is not numeric → 0
    credits: 2000,
    balance: 152884.56,
    flowType: 'income',
  },
  {
    date: '2025-11-08', // '8 de noviembre de 2025'
    description: 'PAGO VIGILANCIA NOVIEMBRE',
    charges: 12500,
    credits: 0,
    balance: 140384.56,
    flowType: 'expense',
  },
];
