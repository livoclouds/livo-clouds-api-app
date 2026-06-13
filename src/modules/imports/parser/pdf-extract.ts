// ---------------------------------------------------------------------------
// PDF text extraction engine.
//
// We use `pdfjs-dist` (the official Mozilla parser) rather than `pdf-parse`
// because we need each text fragment's POSITION (x/y), not just a linearized
// text dump. Bank statements such as the BanBajío "Consulta de Movimientos"
// render the Cargos and Abonos columns as separate cells, and an EMPTY cell
// emits no token — so from text order alone a $500.00 credit and a $0.00 charge
// are indistinguishable. Only the horizontal position of the amount (under the
// Cargos column vs the Abonos column) disambiguates them.
//
// pdfjs-dist v4 ships as ESM only. This file is compiled to CommonJS
// (tsconfig `module: commonjs`), and a plain `await import()` would be
// downleveled by TypeScript to `require()`, which throws on an ESM-only
// package. The Function indirection below preserves a genuine runtime
// `import()` that Node resolves natively.
// ---------------------------------------------------------------------------
const nativeDynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<PdfjsModule>;

interface PdfjsModule {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocument> };
}
interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}
interface PdfPage {
  rotate: number;
  getViewport(params: { scale: number }): PdfViewport;
  getTextContent(): Promise<{ items: PdfRawItem[] }>;
}
interface PdfViewport {
  convertToViewportPoint(x: number, y: number): number[];
}
interface PdfRawItem {
  str?: string;
  transform?: number[];
  width?: number;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = nativeDynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

export interface PositionedItem {
  str: string;
  x: number;
  y: number;
}
export interface VisualRow {
  y: number;
  items: PositionedItem[];
}

export const ROW_Y_TOLERANCE = 4;

/** Extract every visible text fragment with rotation-corrected viewport x/y. */
export async function extractPositionedPages(buffer: Buffer): Promise<PositionedItem[][]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const pages: PositionedItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    // getViewport applies the page's /Rotate, so convertToViewportPoint maps
    // the (possibly rotated) text coordinates back to the visual layout the
    // user sees. BanBajío statements are rotated 90°.
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PositionedItem[] = [];
    for (const raw of content.items) {
      const str = (raw.str ?? '').trim();
      if (!str || !raw.transform) continue;
      const [x, y] = viewport.convertToViewportPoint(raw.transform[4], raw.transform[5]);
      items.push({ str, x, y });
    }
    pages.push(items);
  }
  return pages;
}

/** Cluster positioned items into visual rows (top→bottom, left→right). */
export function buildVisualRows(items: PositionedItem[]): VisualRow[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: VisualRow[] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= ROW_Y_TOLERANCE);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => a.y - b.y);
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}
