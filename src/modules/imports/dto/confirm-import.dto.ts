import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ParsedTransactionDto {
  @IsOptional()
  @IsString()
  transactionNumber?: string;

  @IsString()
  date: string;

  @IsOptional()
  @IsString()
  time?: string;

  @IsOptional()
  @IsString()
  receipt?: string;

  @IsString()
  description: string;

  @IsNumber()
  charges: number;

  @IsNumber()
  credits: number;

  @IsNumber()
  balance: number;

  @IsString()
  flowType: 'income' | 'expense';
}

export class FileImportDto {
  @IsString()
  fileName: string;

  @IsString()
  fileType: string;

  @IsString()
  fileHash: string;

  @IsNumber()
  fileSizeBytes: number;

  @IsArray()
  @IsString({ each: true })
  warnings: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParsedTransactionDto)
  transactions: ParsedTransactionDto[];
}

export class ConfirmImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileImportDto)
  files: FileImportDto[];
}
