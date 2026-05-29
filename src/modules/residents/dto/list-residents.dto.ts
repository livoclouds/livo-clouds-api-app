import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus, ResidentType } from '@prisma/client';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const RESIDENT_SORT_FIELDS = [
  'unitNumber',
  'name',
  'email',
  'paymentStatus',
  'debt',
  'parkingSpots',
  'monthlyFee',
  'lastModified',
] as const;
export type ResidentSortField = (typeof RESIDENT_SORT_FIELDS)[number];

export const RESIDENT_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type ResidentSortDirection = (typeof RESIDENT_SORT_DIRECTIONS)[number];

export const RESIDENT_DOCUMENTATION_FILTERS = ['complete', 'incomplete'] as const;
export type ResidentDocumentationFilter =
  (typeof RESIDENT_DOCUMENTATION_FILTERS)[number];

// Query-string booleans arrive as strings. Read the raw value straight from the
// source object: with the global pipe's enableImplicitConversion, `value` would
// already be coerced ("false" -> true) before this runs. Coerce explicit
// "true"/"false" and leave everything else undefined so an absent param never
// collapses to `false`.
const toOptionalBoolean = ({
  obj,
  key,
}: TransformFnParams): boolean | undefined => {
  const raw = (obj as Record<string, unknown> | undefined)?.[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return undefined;
};

export class ListResidentsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 500;

  @ApiPropertyOptional({
    description: 'Substring match (case-insensitive) on unit number, first name, last name.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({
    description: 'Match on unit number — substring by default, exact when unitExact is true.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  unitNumber?: string;

  @ApiPropertyOptional({ description: 'Treat unitNumber as an exact match.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  unitExact?: boolean;

  @ApiPropertyOptional({
    description: 'Substring match (case-insensitive) on first name or last name.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Substring match on primary or secondary phone.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Substring match (case-insensitive) on email.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string;

  @ApiPropertyOptional({ enum: ResidentType })
  @IsOptional()
  @IsEnum(ResidentType)
  residentType?: ResidentType;

  @ApiPropertyOptional({ minimum: 0, description: 'Minimum debt (inclusive).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDebt?: number;

  @ApiPropertyOptional({ description: 'Filter residents that do / do not have vehicles.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  hasVehicles?: boolean;

  @ApiPropertyOptional({ description: 'Filter residents whose vehicles do / do not carry a tag.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  hasTag?: boolean;

  @ApiPropertyOptional({ description: 'Filter residents that do / do not have pets.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  hasPets?: boolean;

  @ApiPropertyOptional({
    enum: RESIDENT_DOCUMENTATION_FILTERS,
    description: 'complete = all five documentation flags true; incomplete = at least one false.',
  })
  @IsOptional()
  @IsIn(RESIDENT_DOCUMENTATION_FILTERS)
  documentation?: ResidentDocumentationFilter;

  @ApiPropertyOptional({ description: 'Lower bound (inclusive) for updatedAt — ISO date.' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Upper bound (inclusive) for updatedAt — ISO date.' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: RESIDENT_SORT_FIELDS, default: 'unitNumber' })
  @IsOptional()
  @IsIn(RESIDENT_SORT_FIELDS)
  sortBy?: ResidentSortField;

  @ApiPropertyOptional({ enum: RESIDENT_SORT_DIRECTIONS, default: 'asc' })
  @IsOptional()
  @IsIn(RESIDENT_SORT_DIRECTIONS)
  sortDirection?: ResidentSortDirection;
}
