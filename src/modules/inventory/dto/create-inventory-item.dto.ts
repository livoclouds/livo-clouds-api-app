import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export enum InventoryCategoryDto {
  FURNITURE = 'FURNITURE',
  ELECTRONICS = 'ELECTRONICS',
  APPLIANCES = 'APPLIANCES',
  TOOLS = 'TOOLS',
  SECURITY = 'SECURITY',
  COMMUNICATIONS = 'COMMUNICATIONS',
  OFFICE = 'OFFICE',
  CLEANING = 'CLEANING',
  SAFETY = 'SAFETY',
  OTHER = 'OTHER',
}

export enum InventoryConditionDto {
  NEW = 'NEW',
  GOOD = 'GOOD',
  FAIR = 'FAIR',
  DAMAGED = 'DAMAGED',
  REPAIR = 'REPAIR',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
  LOST = 'LOST',
  DISPOSED = 'DISPOSED',
}

export class CreateInventoryItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  commonAreaId: string;

  @ApiProperty({ example: '65" Smart TV' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ enum: InventoryCategoryDto })
  @IsEnum(InventoryCategoryDto)
  category: InventoryCategoryDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ enum: InventoryConditionDto, default: InventoryConditionDto.GOOD })
  @IsOptional()
  @IsEnum(InventoryConditionDto)
  condition?: InventoryConditionDto;

  @ApiPropertyOptional({ example: '2024-03-15' })
  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  approximateCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasInvoice?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
