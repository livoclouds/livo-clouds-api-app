import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  InventoryCategoryDto,
  InventoryConditionDto,
} from './create-inventory-item.dto';

// Allow-list of sortable columns (INV-010). The service maps each value to a
// fixed Prisma `orderBy` expression — a client-supplied `sortBy` is never
// interpolated into Prisma directly. Validating with `@IsIn` here is the first
// of two safety layers (the second is the switch in the service builder).
export const INVENTORY_ITEM_SORT_FIELDS = [
  'name',
  'category',
  'condition',
  'quantity',
  'purchaseDate',
  'commonAreaId',
  'createdAt',
  'updatedAt',
] as const;
export type InventoryItemSortField = (typeof INVENTORY_ITEM_SORT_FIELDS)[number];

export const INVENTORY_ITEM_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type InventoryItemSortDirection =
  (typeof INVENTORY_ITEM_SORT_DIRECTIONS)[number];

export class ListInventoryItemsDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page number for the inventory items list.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1000,
    default: 200,
    description: 'Rows per page. Default covers a typical tenant inventory in a single page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 200;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on the item name.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    enum: InventoryCategoryDto,
    description: 'Exact match on the item category.',
  })
  @IsOptional()
  @IsEnum(InventoryCategoryDto)
  category?: InventoryCategoryDto;

  @ApiPropertyOptional({
    enum: InventoryConditionDto,
    description: 'Exact match on the item condition.',
  })
  @IsOptional()
  @IsEnum(InventoryConditionDto)
  condition?: InventoryConditionDto;

  @ApiPropertyOptional({
    description: 'Filter items located in a specific common area (UUID).',
  })
  @IsOptional()
  @IsUUID()
  commonAreaId?: string;

  @ApiPropertyOptional({
    description: 'Lower bound (inclusive) for purchaseDate, ISO-8601.',
    example: '2024-01-01',
  })
  @IsOptional()
  @IsISO8601()
  purchaseDateFrom?: string;

  @ApiPropertyOptional({
    description: 'Upper bound (inclusive) for purchaseDate, ISO-8601.',
    example: '2024-12-31',
  })
  @IsOptional()
  @IsISO8601()
  purchaseDateTo?: string;

  @ApiPropertyOptional({ enum: INVENTORY_ITEM_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(INVENTORY_ITEM_SORT_FIELDS)
  sortBy?: InventoryItemSortField;

  @ApiPropertyOptional({ enum: INVENTORY_ITEM_SORT_DIRECTIONS, default: 'desc' })
  @IsOptional()
  @IsIn(INVENTORY_ITEM_SORT_DIRECTIONS)
  sortDirection?: InventoryItemSortDirection;
}
