import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Allow-list of sortable columns. The service maps each value to a fixed Prisma
// `orderBy`; a client-supplied `sortBy` is never interpolated directly.
export const VISITOR_LOG_SORT_FIELDS = [
  'visitorName',
  'unit',
  'checkInAt',
  'checkOutAt',
  'createdAt',
] as const;
export type VisitorLogSortField = (typeof VISITOR_LOG_SORT_FIELDS)[number];

export const VISITOR_LOG_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type VisitorLogSortDirection =
  (typeof VISITOR_LOG_SORT_DIRECTIONS)[number];

// active = still inside (checkOutAt null); completed = already left; all = both.
export const VISITOR_LOG_STATUSES = ['active', 'completed', 'all'] as const;
export type VisitorLogStatus = (typeof VISITOR_LOG_STATUSES)[number];

export class ListVisitorLogsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'Case-insensitive match on visitor name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  visitorName?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on the unit.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @ApiPropertyOptional({ enum: VISITOR_LOG_STATUSES, default: 'all' })
  @IsOptional()
  @IsIn(VISITOR_LOG_STATUSES)
  status?: VisitorLogStatus;

  @ApiPropertyOptional({ enum: VISITOR_LOG_SORT_FIELDS, default: 'checkInAt' })
  @IsOptional()
  @IsIn(VISITOR_LOG_SORT_FIELDS)
  sortBy?: VisitorLogSortField;

  @ApiPropertyOptional({ enum: VISITOR_LOG_SORT_DIRECTIONS, default: 'desc' })
  @IsOptional()
  @IsIn(VISITOR_LOG_SORT_DIRECTIONS)
  sortDirection?: VisitorLogSortDirection;
}
