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
import { SupplierStatusDto, SupplierTypeDto } from './create-supplier.dto';

// Allow-list of sortable columns. The service maps each value to a fixed Prisma
// `orderBy` expression — a client-supplied `sortBy` is never interpolated into
// Prisma directly. Validating with `@IsIn` here is the first of two safety
// layers (the second is the switch in the service builder).
export const SUPPLIER_SORT_FIELDS = [
  'supplierName',
  'type',
  'status',
  'registrationDate',
  'createdAt',
  'updatedAt',
] as const;
export type SupplierSortField = (typeof SUPPLIER_SORT_FIELDS)[number];

export const SUPPLIER_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SupplierSortDirection = (typeof SUPPLIER_SORT_DIRECTIONS)[number];

export class ListSuppliersDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 500,
    default: 200,
    description: 'Rows per page. Default covers a typical tenant in one page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 200;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on the supplier name.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: SupplierTypeDto,
    description: 'Exact match on the supplier type.',
  })
  @IsOptional()
  @IsEnum(SupplierTypeDto)
  type?: SupplierTypeDto;

  @ApiPropertyOptional({
    enum: SupplierStatusDto,
    description: 'Exact match on the supplier status.',
  })
  @IsOptional()
  @IsEnum(SupplierStatusDto)
  status?: SupplierStatusDto;

  @ApiPropertyOptional({ enum: SUPPLIER_SORT_FIELDS, default: 'supplierName' })
  @IsOptional()
  @IsIn(SUPPLIER_SORT_FIELDS)
  sortBy?: SupplierSortField;

  @ApiPropertyOptional({ enum: SUPPLIER_SORT_DIRECTIONS, default: 'asc' })
  @IsOptional()
  @IsIn(SUPPLIER_SORT_DIRECTIONS)
  sortDirection?: SupplierSortDirection;
}
