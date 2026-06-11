import { Injectable, Logger } from '@nestjs/common';
import { parseExcelBuffer } from './excel.parser';
import { parsePdfBuffer } from './pdf.parser';
import type { ParsedRow, DetectedPeriod } from './types';
import type { FieldDefinition } from './default-aliases';

export type { ParsedRow, DetectedPeriod };
export { buildPeriods, computeFinalBalance } from './types';
export {
  DEFAULT_FIELD_DEFINITIONS,
  SYSTEM_FIELD_KEYS,
  ImportProfileMismatchError,
  type FieldDefinition,
  type SystemFieldKey,
} from './default-aliases';

export interface ServerParseResult {
  transactions: ParsedRow[];
  warnings: string[];
}

// ENGINE-028 — per-file row-validation summary surfaced at preview time so
// the user learns about silently-droppable rows BEFORE confirming. Mirrors
// the service-side ValidationReport but caps the error list (sampleErrors).
export interface PreviewRowError {
  rowIndex: number;
  field: string;
  message: string;
}

export interface PreviewValidationSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  invalidRatio: number;
  sampleErrors: PreviewRowError[];
}

export interface PreviewFileResult {
  id: string;
  fileName: string;
  fileType: 'xlsx' | 'pdf';
  fileSizeBytes: number;
  fileHash: string;
  status: 'success' | 'warning' | 'error' | 'duplicate';
  statusMessage?: string;
  periods: DetectedPeriod[];
  transactionCount: number;
  totalIncome: number;
  totalExpenses: number;
  finalBalance: number;
  transactions: ParsedRow[];
  warnings: string[];
  validation?: PreviewValidationSummary;
  processedAt: string;
}

export interface PreviewApiResponse {
  results: PreviewFileResult[];
}

@Injectable()
export class ImportsParserService {
  private readonly logger = new Logger(ImportsParserService.name);

  async parseBuffer(
    buffer: Buffer,
    fileType: string,
    fields?: FieldDefinition[],
  ): Promise<ServerParseResult> {
    const normalized = fileType.toLowerCase();
    if (normalized === 'xlsx' || normalized.includes('spreadsheet')) {
      return parseExcelBuffer(buffer, { fields });
    }
    if (normalized === 'pdf' || normalized.includes('pdf')) {
      return parsePdfBuffer(buffer, { fields });
    }
    this.logger.warn(`parseBuffer: unsupported fileType=${fileType}`);
    return {
      transactions: [],
      warnings: [`Unsupported file type for server re-parse: ${fileType}`],
    };
  }
}
