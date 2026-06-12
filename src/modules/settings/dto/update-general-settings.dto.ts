import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// Per-condominium financial-health score weights (Fase 4). Each is a relative
// importance 0–100; the scorer auto-normalizes the seven to sum 100. All seven
// keys are required when the object is sent.
export class FinancialHealthWeightsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsNumber() @Min(0) @Max(100) onTime!: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsNumber() @Min(0) @Max(100) collectionRate!: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsNumber() @Min(0) @Max(100) monthsCurrent!: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsNumber() @Min(0) @Max(100) delinquencyAge!: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsNumber() @Min(0) @Max(100) balance!: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsNumber() @Min(0) @Max(100) recurrence!: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 }) @IsNumber() @Min(0) @Max(100) trend!: number;
}

export class UpdateGeneralSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'America/Monterrey' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 'MX' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'MXN' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adminPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: 'es' })
  @IsOptional()
  @IsString()
  defaultLocale?: string;

  @ApiPropertyOptional({ example: 'Mon–Fri 09:00–18:00' })
  @IsOptional()
  @IsString()
  businessHours?: string;

  // Resident dossier retention window in days. 0 = no window (opt-in).
  @ApiPropertyOptional({ example: 365, minimum: 0, maximum: 3650 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  dossierRetentionDays?: number;

  // Whether the scheduled auto-purge runs (gates the sweep alongside the window).
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  autopurgeEnabled?: boolean;

  // Per-condominium financial-health score weights (Fase 4). Relative importances;
  // auto-normalized to sum 100 at compute time. The service rejects an all-zero set.
  @ApiPropertyOptional({ type: FinancialHealthWeightsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FinancialHealthWeightsDto)
  financialHealthWeights?: FinancialHealthWeightsDto;
}
