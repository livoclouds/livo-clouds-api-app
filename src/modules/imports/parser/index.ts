import { Injectable, Logger } from '@nestjs/common';
import { parseExcelBuffer } from './excel.parser';
import { parsePdfBuffer } from './pdf.parser';
import type { ParsedRow } from './types';

export type { ParsedRow };

export interface ServerParseResult {
  transactions: ParsedRow[];
  warnings: string[];
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
