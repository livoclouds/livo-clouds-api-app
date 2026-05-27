import { IsEnum, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ImportStatus } from '@prisma/client';

export class ListImportBatchesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 15;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  fileType?: string;

  @IsOptional()
  @IsString()
  importedByName?: string;

  @IsOptional()
  @IsEnum(ImportStatus)
  status?: ImportStatus;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  transactionCountMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  transactionCountMax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  incomeMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  incomeMax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  expensesMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  expensesMax?: number;
}
