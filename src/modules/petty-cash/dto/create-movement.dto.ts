import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export enum MovementTypeDto {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  ADJUSTMENT = 'ADJUSTMENT',
  REIMBURSEMENT = 'REIMBURSEMENT',
}

export enum MovementCategoryDto {
  CLEANING = 'CLEANING',
  STATIONERY = 'STATIONERY',
  INTERNET = 'INTERNET',
  WATER = 'WATER',
  CAFETERIA = 'CAFETERIA',
  GATEHOUSE = 'GATEHOUSE',
  GARDENING = 'GARDENING',
  MAINTENANCE = 'MAINTENANCE',
  TOOLS = 'TOOLS',
  SERVICES = 'SERVICES',
  URGENT_PURCHASES = 'URGENT_PURCHASES',
  OTHER = 'OTHER',
}

export enum DeliveryMethodDto {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  CHECK = 'CHECK',
}

export class CreateMovementDto {
  @ApiProperty({ example: '2026-01-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ enum: MovementTypeDto })
  @IsEnum(MovementTypeDto)
  movementType: MovementTypeDto;

  @ApiProperty({ enum: MovementCategoryDto })
  @IsEnum(MovementCategoryDto)
  category: MovementCategoryDto;

  @ApiProperty({ example: 'Office supplies purchase' })
  @IsString()
  @MinLength(1)
  concept: string;

  @ApiProperty({ example: 150.5 })
  @IsNumber()
  @Min(0.01)
  @Transform(({ value }) => parseFloat(value))
  amount: number;

  @ApiProperty({ enum: DeliveryMethodDto, default: DeliveryMethodDto.CASH })
  @IsEnum(DeliveryMethodDto)
  deliveryMethod: DeliveryMethodDto;

  @ApiProperty({ example: 'Maria Garcia' })
  @IsString()
  @MinLength(1)
  responsible: string;

  @ApiPropertyOptional({ example: 'Office Depot' })
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasReceipt?: boolean;

  @ApiPropertyOptional({ example: 'REC-0042' })
  @IsOptional()
  @IsString()
  receiptNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  authorizedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
