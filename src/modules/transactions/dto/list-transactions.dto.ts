import { IsEnum, IsInt, IsISO8601, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';
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
}
