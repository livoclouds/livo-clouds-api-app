import { buildAliasIndex, DEFAULT_FIELD_DEFINITIONS } from './default-aliases';
import { parsePositional } from './pdf-positional';
import type { PositionedItem } from './pdf-extract';
import { parseDate, parseAmountToken } from './pdf-tokens';

// ---------------------------------------------------------------------------
// These tests use SYNTHETIC positioned-text fixtures — never a real bank
// statement — for condominium confidentiality. The coordinates mimic the
// BanBajío "Consulta de Movimientos" layout AFTER rotation correction (the
// shape extractPositionedPages emits): a metadata block above a table header,
// records anchored by a date in the Fecha column, wrapped multi-line
// descriptions, and Cargos/Abonos cells where an EMPTY cell emits no token.
// All names / accounts / amounts below are fabricated.
//
// parsePositional operates on already-rotation-corrected items, so feeding it
// synthetic items exercises the exact reconstruction logic where the three
// real-world bugs lived (header detection, dd-MonAbbr dates, and telling a
// Cargos entry from an Abonos entry by column x) without any real data or any
// pdfjs dependency in the test.
// ---------------------------------------------------------------------------

const aliasIndex = buildAliasIndex(DEFAULT_FIELD_DEFINITIONS);

// Column x-centers mirroring the real rotated layout.
const X = {
  index: 46, date: 96, time: 196, receipt: 284,
  desc: 393, cargos: 830, abonos: 944, saldo: 1063,
};
// Header label x-centers (centered headers sit right of their left-aligned body).
const HX = {
  index: 46, date: 113, time: 204, receipt: 303,
  desc: 543, cargos: 797, abonos: 910, saldo: 1044,
};

function item(str: string, x: number, y: number): PositionedItem {
  return { str, x, y };
}

const headerRow = (y: number): PositionedItem[] => [
  item('#', HX.index, y),
  item('Fecha', HX.date, y),
  item('Hora', HX.time, y),
  item('Recibo', HX.receipt, y),
  item('Descripción', HX.desc, y),
  item('Cargos', HX.cargos, y),
  item('Abonos', HX.abonos, y),
  item('Saldo', HX.saldo, y),
];

interface SyntheticTx {
  idx: string;
  date: string;
  time: string;
  receipt: string;
  descLines: string[];
  credit?: string; // value under Abonos
  charge?: string; // value under Cargos (may be "$0.00")
  saldo: string;
}

/** Lay a transaction out as an anchor row plus description lines around it. */
function txRows(tx: SyntheticTx, anchorY: number): PositionedItem[] {
  const items: PositionedItem[] = [];
  // description lines straddle the anchor (mimics tall wrapped cells)
  tx.descLines.forEach((line, i) => {
    items.push(item(line, X.desc, anchorY - 6 + i * 6));
  });
  const row: PositionedItem[] = [
    item(tx.idx, X.index, anchorY),
    item(tx.date, X.date, anchorY),
    item(tx.time, X.time, anchorY),
    item(tx.receipt, X.receipt, anchorY),
    item(tx.saldo, X.saldo, anchorY),
  ];
  if (tx.credit !== undefined) row.push(item(tx.credit, X.abonos, anchorY));
  if (tx.charge !== undefined) row.push(item(tx.charge, X.cargos, anchorY));
  return [...items, ...row];
}

const SYNTHETIC: SyntheticTx[] = [
  {
    idx: '1', date: '31-May-2026', time: '21:17:46', receipt: '111111111111',
    descLines: [
      'SPEI Recibido: | Ordenante: RESIDENTE UNO Cuenta Ordenante:',
      '000000000000000000 Concepto del Pago: Mantenimiento Casa 1',
    ],
    credit: '$500.00', saldo: '$2,100.00',
  },
  {
    idx: '2', date: '30-May-2026', time: '10:36:24', receipt: '222222222222',
    descLines: ['SPEI Recibido: | Ordenante: RESIDENTE DOS Concepto: casa 2'],
    credit: '$1,100.00', saldo: '$1,600.00',
  },
  {
    idx: '3', date: '30-May-2026', time: '11:40:26', receipt: '333333333333',
    descLines: ['IVA Comisión por Transferencia - Envío ; (SPEI; Banca por Internet)'],
    charge: '$0.00', saldo: '$500.00',
  },
  {
    idx: '4', date: '01-May-2026', time: '09:00:00', receipt: '444444444444',
    descLines: ['SPEI Enviado: | Beneficiario: PROVEEDOR FICTICIO | Servicios'],
    charge: '$37,500.00', saldo: '$500.00',
  },
];

function buildSyntheticPage(): PositionedItem[] {
  const page: PositionedItem[] = [];
  // Metadata block ABOVE the header. Under the OLD substring matcher these
  // cells ("Número Cliente"→transactionNumber, "Fechas"→date, "Cargos
  // Totales"→charges) masqueraded as a header and dropped page-1 rows; exact
  // matching must skip them.
  page.push(
    item('Número Cliente', 134, 40),
    item('Fechas', 460, 40),
    item('Cargos Totales', 804, 40),
    item('$-37,500.00', 914, 40),
  );
  page.push(...headerRow(145));
  let y = 200;
  for (const tx of SYNTHETIC) {
    page.push(...txRows(tx, y));
    y += 40;
  }
  // Document footer disclaimer that lands in the description band of the last
  // record; must be trimmed, not appended to its description.
  page.push(item('La información contenida en este archivo es informativa.', X.desc, y - 34));
  return page;
}

describe('parsePositional — synthetic BanBajío-style table', () => {
  const result = parsePositional([buildSyntheticPage()], aliasIndex, DEFAULT_FIELD_DEFINITIONS);

  it('detects the real header (not the metadata block) and extracts every record', () => {
    expect(result.matched).toBe(true);
    expect(result.transactions).toHaveLength(SYNTHETIC.length);
  });

  it('sums credits and charges from the correct columns', () => {
    const credits = result.transactions.reduce((s, t) => s + t.credits, 0);
    const charges = result.transactions.reduce((s, t) => s + t.charges, 0);
    expect(credits).toBeCloseTo(1600.0, 2); // 500 + 1100
    expect(charges).toBeCloseTo(37500.0, 2); // 0 + 37500
  });

  it('classifies a credit by COLUMN position, not text order', () => {
    const first = result.transactions[0];
    expect(first.date).toBe('2026-05-31');
    expect(first.time).toBe('21:17:46');
    expect(first.receipt).toBe('111111111111');
    expect(first.credits).toBe(500);
    expect(first.charges).toBe(0);
    expect(first.balance).toBeCloseTo(2100.0, 2);
    expect(first.flowType).toBe('income');
    expect(first.description).toContain('RESIDENTE UNO');
    expect(first.description).toContain('Mantenimiento Casa 1');
  });

  it('treats a $0.00 amount under Cargos as an expense (empty-Abonos case)', () => {
    const commission = result.transactions.find((t) =>
      t.description.includes('IVA Comisión'),
    );
    expect(commission).toBeDefined();
    expect(commission!.charges).toBe(0);
    expect(commission!.credits).toBe(0);
    expect(commission!.flowType).toBe('expense');

    const expense = result.transactions.find((t) => t.charges === 37500);
    expect(expense!.flowType).toBe('expense');
    expect(expense!.credits).toBe(0);
  });

  it('parses dd-MonAbbr-yyyy dates into ISO for every record', () => {
    for (const tx of result.transactions) {
      expect(tx.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(result.transactions[result.transactions.length - 1].date).toBe('2026-05-01');
  });

  it('trims the statement footer disclaimer out of the last description', () => {
    const last = result.transactions[result.transactions.length - 1];
    expect(last.description).not.toMatch(/La informaci[oó]n contenida/i);
    expect(last.description).toContain('PROVEEDOR FICTICIO');
  });
});

describe('parseDate', () => {
  it('parses the dd-MonAbbr-yyyy format (Spanish abbreviations)', () => {
    expect(parseDate('31-May-2026')).toBe('2026-05-31');
    expect(parseDate('02-Jun-2026')).toBe('2026-06-02');
    expect(parseDate('01-Ene-2026')).toBe('2026-01-01');
    expect(parseDate('15-Dic-2025')).toBe('2025-12-15');
  });

  it('still parses the pre-existing formats', () => {
    expect(parseDate('5 de mayo de 2026')).toBe('2026-05-05');
    expect(parseDate('31/05/2026')).toBe('2026-05-31');
    expect(parseDate('2026-05-31')).toBe('2026-05-31');
  });

  it('returns null for non-dates', () => {
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate('21:17:46')).toBeNull();
  });
});

describe('parseAmountToken', () => {
  it('parses US-format amounts', () => {
    expect(parseAmountToken('$500.00').value).toBe(500);
    expect(parseAmountToken('$286,568.71').value).toBeCloseTo(286568.71, 2);
    expect(parseAmountToken('$0.00').value).toBe(0);
  });

  it('flags European-format amounts as ambiguous instead of mis-parsing', () => {
    const r = parseAmountToken('1.234,56');
    expect(r.issue).toBe('ambiguousDecimal');
    expect(Number.isNaN(r.value)).toBe(true);
  });
});
