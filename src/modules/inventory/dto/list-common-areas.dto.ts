import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CommonAreaStatusDto } from './create-common-area.dto';

// Allow-list of sortable columns (CMA-013). The service maps each value to a
// fixed Prisma `orderBy` expression — a client-supplied `sortBy` is never
// interpolated into Prisma directly. Validating with `@IsIn` here is the first
// of two safety layers (the second is the switch in the service builder).
export const COMMON_AREA_SORT_FIELDS = [
  'name',
  'status',
  'responsiblePerson',
  'physicalLocation',
  'createdAt',
  'updatedAt',
] as const;
export type CommonAreaSortField = (typeof COMMON_AREA_SORT_FIELDS)[number];

export const COMMON_AREA_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type CommonAreaSortDirection =
  (typeof COMMON_AREA_SORT_DIRECTIONS)[number];

export class ListCommonAreasDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page number for the common areas list.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 500,
    default: 200,
    description: 'Rows per page. Default covers every current tenant in a single page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 200;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on the area name.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    enum: CommonAreaStatusDto,
    description: 'Exact match on the area status.',
  })
  @IsOptional()
  @IsEnum(CommonAreaStatusDto)
  status?: CommonAreaStatusDto;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on the responsible person.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  responsible?: string;

  @ApiPropertyOptional({ enum: COMMON_AREA_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(COMMON_AREA_SORT_FIELDS)
  sortBy?: CommonAreaSortField;

  @ApiPropertyOptional({ enum: COMMON_AREA_SORT_DIRECTIONS, default: 'asc' })
  @IsOptional()
  @IsIn(COMMON_AREA_SORT_DIRECTIONS)
  sortDirection?: CommonAreaSortDirection;
}
