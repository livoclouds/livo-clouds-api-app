/**
 * Golden parser tests (audit finding ENGINE-032).
 *
 * Each test feeds an in-memory workbook fixture through `parseExcelBuffer`
 * and asserts DEEP equality against the pinned `EXPECTED_*` constant — exact
 * row count, dates, charges/credits/balance, descriptions, flowType, and
 * warnings. Any behavioral drift in header detection, alias matching, date
 * parsing, or amount parsing fails with a precise diff.
 *
 * Fixtures and expectations live in `testing/bank-workbook-fixtures.ts`.
 */
import { parseExcelBuffer } from './excel.parser';
import {
  buildBanBajioWorkbook,
  buildDebitoCreditoWorkbook,
  buildDefaultLayoutWorkbook,
  buildEnglishLayoutWorkbook,
  buildHostileCellsWorkbook,
  buildRetirosDepositosWorkbook,
  EXPECTED_BANBAJIO,
  EXPECTED_DEBITO_CREDITO,
  EXPECTED_DEFAULT_LAYOUT,
  EXPECTED_ENGLISH_LAYOUT,
  EXPECTED_HOSTILE_CELLS,
  EXPECTED_RETIROS_DEPOSITOS,
} from './testing/bank-workbook-fixtures';

describe('parseExcelBuffer — golden bank fixtures (ENGINE-032)', () => {
  it('parses the default Spanish layout (Fecha/Descripción/Cargos/Abonos/Saldo) exactly', async () => {
    const result = await parseExcelBuffer(await buildDefaultLayoutWorkbook());
    expect(result.transactions).toEqual(EXPECTED_DEFAULT_LAYOUT);
    expect(result.warnings).toEqual([]);
  });

  it('parses a BanBajío-style statement (junk title rows + DD/MON/YYYY text dates + Concepto column) exactly', async () => {
    const result = await parseExcelBuffer(await buildBanBajioWorkbook());
    expect(result.transactions).toEqual(EXPECTED_BANBAJIO);
    expect(result.warnings).toEqual([]);
  });

  it('parses the Retiros/Depósitos alias family with DD/MM/YYYY text dates exactly', async () => {
    const result = await parseExcelBuffer(await buildRetirosDepositosWorkbook());
    expect(result.transactions).toEqual(EXPECTED_RETIROS_DEPOSITOS);
    expect(result.warnings).toEqual([]);
  });

  it('parses the Débito/Crédito alias family (Fecha Operación substring-matches date) exactly', async () => {
    const result = await parseExcelBuffer(await buildDebitoCreditoWorkbook());
    expect(result.transactions).toEqual(EXPECTED_DEBITO_CREDITO);
    expect(result.warnings).toEqual([]);
  });

  it('parses the English alias family (Date/Description/Charges/Credits/Balance, ISO text dates) exactly', async () => {
    const result = await parseExcelBuffer(await buildEnglishLayoutWorkbook());
    expect(result.transactions).toEqual(EXPECTED_ENGLISH_LAYOUT);
    expect(result.warnings).toEqual([]);
  });

  it('parses hostile cells (currency text, parens negatives, blank/invalid rows, serial + Spanish long dates) exactly', async () => {
    const result = await parseExcelBuffer(await buildHostileCellsWorkbook());
    expect(result.transactions).toEqual(EXPECTED_HOSTILE_CELLS);
    // Rows with an unparseable date or an empty description with zero amounts
    // are dropped SILENTLY — the parser only warns when zero transactions
    // were extracted overall, so a partially-dirty file yields no warnings.
    expect(result.warnings).toEqual([]);
  });
});
