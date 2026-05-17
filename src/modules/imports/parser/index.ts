import { Injectable, Logger } from '@nestjs/common';
import { parseExcelBuffer } from './excel.parser';
import { parsePdfBuffer } from './pdf.parser';
import type { ParsedRow, DetectedPeriod } from './types';

export type { ParsedRow, DetectedPeriod };
export { buildPeriods } from './types';

export interface ServerParseResult {
  transactions: ParsedRow[];
  warnings: string[];
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
  ): Promise<ServerParseResult> {
    const normalized = fileType.toLowerCase();
    if (normalized === 'xlsx' || normalized.includes('spreadsheet')) {
      return parseExcelBuffer(buffer);
    }
    if (normalized === 'pdf' || normalized.includes('pdf')) {
      return parsePdfBuffer(buffer);
    }
    this.logger.warn(`parseBuffer: unsupported fileType=${fileType}`);
    return {
      transactions: [],
      warnings: [`Unsupported file type for server re-parse: ${fileType}`],
    };
  }
}
