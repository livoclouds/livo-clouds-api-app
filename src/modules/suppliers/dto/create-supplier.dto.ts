import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export enum SupplierTypeDto {
  MAINTENANCE = 'MAINTENANCE',
  SECURITY = 'SECURITY',
  ELECTRICAL = 'ELECTRICAL',
  PLUMBING = 'PLUMBING',
  LANDSCAPING = 'LANDSCAPING',
  CLEANING = 'CLEANING',
  PAINTING = 'PAINTING',
  ELEVATOR = 'ELEVATOR',
  TECHNOLOGY = 'TECHNOLOGY',
  ADMINISTRATION = 'ADMINISTRATION',
}

export enum SupplierStatusDto {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
}

export class CreateSupplierDto {
  @ApiProperty({ example: 'Constructora Vidal Hermanos' })
  @IsString()
  @MinLength(1)
  supplierName: string;

  @ApiProperty({ enum: SupplierTypeDto })
  @IsEnum(SupplierTypeDto)
  type: SupplierTypeDto;

  @ApiPropertyOptional({ example: 'Luis Vidal' })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ example: 'lvidal@vidal.mx' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '555-201-4432' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Av. Industrial 330' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'CVH220801VH3' })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional({
    example: '2026-05-06',
    description: 'Registration date (ISO-8601 date).',
  })
  @IsOptional()
  @IsString()
  registrationDate?: string;

  @ApiPropertyOptional({
    enum: SupplierStatusDto,
    default: SupplierStatusDto.ACTIVE,
  })
  @IsOptional()
  @IsEnum(SupplierStatusDto)
  status?: SupplierStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
