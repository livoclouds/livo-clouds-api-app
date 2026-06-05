import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// DTO-level enum mirrors of the Prisma enums. Kept local (not imported from
// @prisma/client) so the validation contract is explicit and independent of the
// generated client.
export enum DossierCategoryDto {
  SANCTION = 'SANCTION',
  LEGAL = 'LEGAL',
  COEXISTENCE = 'COEXISTENCE',
  PROPERTY = 'PROPERTY',
  DANGEROUS_PET = 'DANGEROUS_PET',
}

export enum DossierSeverityDto {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum DossierStatusDto {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  ARCHIVED = 'ARCHIVED',
}

export enum DossierConfidentialityDto {
  STANDARD = 'STANDARD',
  RESTRICTED = 'RESTRICTED',
  LEGAL_CONFIDENTIAL = 'LEGAL_CONFIDENTIAL',
}

const MAX = {
  title: 160,
  description: 4000,
  folio: 120,
} as const;

export class CreateDossierEntryDto {
  @ApiProperty({ enum: DossierCategoryDto })
  @IsEnum(DossierCategoryDto)
  category: DossierCategoryDto;

  @ApiPropertyOptional({ enum: DossierSeverityDto, default: DossierSeverityDto.LOW })
  @IsOptional()
  @IsEnum(DossierSeverityDto)
  severity?: DossierSeverityDto;

  @ApiPropertyOptional({ enum: DossierStatusDto, default: DossierStatusDto.OPEN })
  @IsOptional()
  @IsEnum(DossierStatusDto)
  status?: DossierStatusDto;

  @ApiPropertyOptional({
    enum: DossierConfidentialityDto,
    default: DossierConfidentialityDto.STANDARD,
  })
  @IsOptional()
  @IsEnum(DossierConfidentialityDto)
  confidentiality?: DossierConfidentialityDto;

  @ApiProperty({ example: 'Multa aprobada en asamblea' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX.title)
  title: string;

  @ApiProperty({ example: 'Sanción por uso indebido de área común…' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX.description)
  description: string;

  @ApiPropertyOptional({ example: 'Acta #12' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX.folio)
  referenceFolio?: string;

  @ApiPropertyOptional({ example: 1500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiProperty({ example: '2026-03-14' })
  @IsISO8601()
  occurredAt: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsISO8601()
  resolvedAt?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
