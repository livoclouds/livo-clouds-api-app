import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
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
  @IsIn(['reconciledAt', 'transactionDate', 'paymentConcept', 'unit'])
  sortBy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortDir?: string;
}
