import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
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

// Coarse directory bucket driving the Proveedores filter chips + card icon.
export enum SupplierCategoryDto {
  ADMINISTRATION = 'ADMINISTRATION',
  SURVEILLANCE = 'SURVEILLANCE',
  GARDENING = 'GARDENING',
  CLEANING = 'CLEANING',
  MAINTENANCE = 'MAINTENANCE',
  SERVICES = 'SERVICES',
  OTHER = 'OTHER',
}

// FIXED → recurring "Proveedor fijo"; OCCASIONAL → ad-hoc "Eventual".
export enum SupplierEngagementDto {
  FIXED = 'FIXED',
  OCCASIONAL = 'OCCASIONAL',
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

  // Legacy fine-grained type. Optional for new callers (the Proveedores wizard
  // sends `category` only) — the service derives it from `category` when omitted
  // so the dashboard + reconciliation continue to see a populated `type`.
  @ApiPropertyOptional({ enum: SupplierTypeDto })
  @IsOptional()
  @IsEnum(SupplierTypeDto)
  type?: SupplierTypeDto;

  @ApiPropertyOptional({
    enum: SupplierCategoryDto,
    default: SupplierCategoryDto.OTHER,
    description: 'Coarse directory bucket shown in the Proveedores UI.',
  })
  @IsOptional()
  @IsEnum(SupplierCategoryDto)
  category?: SupplierCategoryDto;

  @ApiPropertyOptional({
    enum: SupplierEngagementDto,
    default: SupplierEngagementDto.OCCASIONAL,
    description: 'FIXED = recurring supplier, OCCASIONAL = ad-hoc.',
  })
  @IsOptional()
  @IsEnum(SupplierEngagementDto)
  engagementType?: SupplierEngagementDto;

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

  @ApiPropertyOptional({ example: '33 0000 0000' })
  @IsOptional()
  @IsString()
  whatsapp?: string;

  @ApiPropertyOptional({ example: 'Av. Industrial 330' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Lun–Vie 9:00–18:00 · bajo llamado' })
  @IsOptional()
  @IsString()
  availability?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the supplier also serves residents privately.',
  })
  @IsOptional()
  @IsBoolean()
  servesResidents?: boolean;

  @ApiPropertyOptional({
    example: 'Recomendado por el comité; atiende a 2 cotos vecinos.',
    description: 'Trust/reference notes shown in the supplier panel.',
  })
  @IsOptional()
  @IsString()
  references?: string;

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
