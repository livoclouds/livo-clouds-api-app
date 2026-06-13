import type { ParsedRow } from './types';
import {
  buildAliasIndex,
  DEFAULT_FIELD_DEFINITIONS,
  type FieldDefinition,
} from './default-aliases';
import {
  buildVisualRows,
  extractPositionedPages,
  type PositionedItem,
} from './pdf-extract';
import { parsePositional } from './pdf-positional';
import { parseLineBased } from './pdf-line-based';

// ---------------------------------------------------------------------------
// PDF statement parser — orchestrator.
//
// Extracts positioned text with pdfjs-dist (see pdf-extract), reconstructs the
// transaction table by column position (see pdf-positional), and falls back to
// the legacy line-based heuristic (see pdf-line-based) for non-tabular dumps.
// The positional path is what lets us tell a Cargos entry apart from an Abonos
// entry when one cell is empty — text order alone cannot. See pdf.parser.spec.ts
// for the BanBajío regression fixture.
// ---------------------------------------------------------------------------

const MIN_TEXT_CHARS = 50;

export interface PdfParseResult {
  transactions: ParsedRow[];
  warnings: string[];
}

export interface PdfParseOptions {
  fields?: FieldDefinition[];
}

export async function parsePdfBuffer(
  buffer: Buffer,
  options: PdfParseOptions = {},
): Promise<PdfParseResult> {
  const fields =
    options.fields && options.fields.length > 0
      ? options.fields
      : DEFAULT_FIELD_DEFINITIONS;
  const aliasIndex = buildAliasIndex(fields);

  let pages: PositionedItem[][];
  try {
    pages = await extractPositionedPages(buffer);
  } catch {
    return {
      transactions: [],
      warnings: ['Could not read PDF file. The file may be corrupted or encrypted.'],
    };
  }

  const totalChars = pages.reduce(
    (sum, items) => sum + items.reduce((s, it) => s + it.str.length, 0),
    0,
  );
  if (totalChars < MIN_TEXT_CHARS) {
    return {
      transactions: [],
      warnings: [
        'This PDF appears to be image-based (scanned). Text extraction is not possible for scanned documents. Please use a PDF exported directly from your banking portal.',
      ],
    };
  }

  // Primary path: positional table reconstruction.
  const positional = parsePositional(pages, aliasIndex, fields);
  if (positional.matched) {
    return { transactions: positional.transactions, warnings: [] };
  }

  // Fallback: linearize the positional rows into text and run the legacy
  // line-based heuristic (covers single-column / non-tabular text dumps).
  const text = pages
    .map((items) =>
      buildVisualRows(items)
        .map((row) => row.items.map((it) => it.str).join(' '))
        .join('\n'),
    )
    .join('\n');

  return parseLineBased(text, aliasIndex, fields);
}
