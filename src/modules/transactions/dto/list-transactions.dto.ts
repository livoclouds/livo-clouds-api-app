import { IsEnum, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ClassificationStatus, FlowType } from '@prisma/client';

export class ListTransactionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsEnum(FlowType)
  flowType?: FlowType;

  @IsOptional()
  @IsEnum(ClassificationStatus)
  classificationStatus?: ClassificationStatus;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  residentId?: string;

  @IsOptional()
  @IsUUID()
  importBatchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Matches(/^[a-zA-Z0-9_,]+$/, {
    message: 'columns must be a comma-separated list of allowlisted column IDs',
  })
  columns?: string;

  @IsOptional()
  @IsString()
  @IsIn(['reconciledAt', 'transactionDate', 'paymentConcept', 'unit', 'paymentPeriodYear', 'amount', 'confidenceScore'])
  sortBy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortDir?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  concept?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  unitNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  residentName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(?:0[1-9]|1[0-2])$/, { message: 'period must be in YYYY-MM format' })
  period?: string;

  @IsOptional()
  @IsString()
  @IsIn(['HIGH', 'MEDIUM', 'LOW'])
  confidenceLevel?: 'HIGH' | 'MEDIUM' | 'LOW';

  // Filter by absolute transaction magnitude (matches credits OR charges).
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amountMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amountMax?: number;

  // Filter by import recency, expressed as an age window in minutes against
  // createdAt. minAge → "older than" (createdAt <= now - min); maxAge → "within
  // the last" (createdAt >= now - max). Both together = a band. Max cap ~10y.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5_256_000)
  importedMinAgeMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5_256_000)
  importedMaxAgeMinutes?: number;
}
