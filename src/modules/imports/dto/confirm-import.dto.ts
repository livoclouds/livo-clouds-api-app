import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// CLAUDE.md §19 — 20 MB hard ceiling. Duplicated locally instead of imported
// from imports.service.ts to keep DTO and service decoupled.
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS_PER_IMPORT = 10_000;
// ENGINE-050 — ISO-8601 only. Both server parsers (XLSX and PDF) emit
// YYYY-MM-DD, and confirm's reconciliation compares dates with strict string
// equality — a D/M/YYYY date can never match a server row, so accepting it
// here only converted a clear validation error into a false PAYLOAD_MISMATCH.
// Accepts: YYYY-MM-DD and YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±HH:mm].
const DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
// Reject path traversal and control characters in filename (IMP-012 + IMP-015
// defensive overlap at the DTO surface).
const SAFE_FILENAME_REGEX = /^[^/\\\x00-\x1f]+$/;
const HASH_REGEX = /^[0-9a-f]{64}$/i;

export class ParsedTransactionDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  transactionNumber?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(40)
  @Matches(DATE_REGEX, {
    message: 'date must be ISO-8601 (YYYY-MM-DD[Thh:mm[:ss[.sss]][Z|±HH:mm]])',
  })
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  receipt?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;

  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 },
    { message: 'charges must be a finite number' },
  )
  @Min(0)
  charges: number;

  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 },
    { message: 'credits must be a finite number' },
  )
  @Min(0)
  credits: number;

  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 },
    { message: 'balance must be a finite number' },
  )
  balance: number;

  @IsIn(['income', 'expense'], {
    message: "flowType must be 'income' or 'expense'",
  })
  flowType: 'income' | 'expense';
}

export class FileImportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(SAFE_FILENAME_REGEX, {
    message: 'fileName must not contain path separators or control characters',
  })
  fileName: string;

  @IsString()
  @IsIn(['xlsx', 'pdf'], { message: "fileType must be 'xlsx' or 'pdf'" })
  fileType: string;

  @IsString()
  @Matches(HASH_REGEX, {
    message: 'fileHash must be a 64-character lowercase hex string (SHA-256)',
  })
  fileHash: string;

  // Phase 3: optional explicit batch reference. When provided, confirm prefers
  // id-based lookup over fileHash and validates tenant ownership.
  @IsOptional()
  @IsUUID('4', { message: 'batchId must be a valid UUID v4' })
  batchId?: string;

  @IsInt({ message: 'fileSizeBytes must be a non-negative integer' })
  @Min(1)
  @Max(MAX_FILE_SIZE_BYTES, {
    message: `fileSizeBytes must not exceed ${MAX_FILE_SIZE_BYTES} bytes (20 MB)`,
  })
  fileSizeBytes: number;

  @IsArray()
  @ArrayMaxSize(64, {
    message: 'warnings must not exceed 64 entries',
  })
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  warnings: string[];

  @IsArray()
  @ArrayMaxSize(MAX_ROWS_PER_IMPORT, {
    message: `transactions must not exceed ${MAX_ROWS_PER_IMPORT} rows`,
  })
  @ValidateNested({ each: true })
  @Type(() => ParsedTransactionDto)
  transactions: ParsedTransactionDto[];
}

export class ConfirmImportDto {
  @IsArray()
  @ArrayMaxSize(5, { message: 'files must not exceed 5 entries per confirm' })
  @ValidateNested({ each: true })
  @Type(() => FileImportDto)
  files: FileImportDto[];

  // The bank profile chosen for this import. Persisted onto every batch so the
  // classification engine knows which bank's description format to parse (e.g.
  // BanBajío unit extraction). All files in one confirm share the same profile.
  @IsOptional()
  @IsUUID('4', { message: 'bankProfileId must be a valid UUID v4' })
  bankProfileId?: string;
}
