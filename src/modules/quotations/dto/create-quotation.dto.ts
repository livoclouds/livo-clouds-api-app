import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * A single provider's quote attached to a request. `amount` is a positive money
 * value (stored as Decimal(12,2)); `documentUrl` is an already-persisted URL
 * (file upload to R2 is handled separately by the storage module).
 */
export class CreateQuotationDto {
  @ApiProperty({ example: 'Constructora Vidal Hermanos' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  providerName: string;

  @ApiPropertyOptional({ example: '55 5555 5555' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  providerPhone?: string | null;

  @ApiPropertyOptional({ example: 'ventas@vidal.mx' })
  @IsOptional()
  @IsEmail()
  providerEmail?: string | null;

  @ApiProperty({ example: 12500.5, minimum: 0.01, maximum: 99_999_999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  amount: number;

  @ApiPropertyOptional({ example: 'MXN', default: 'MXN' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ example: '2026-06-02', description: 'ISO date.' })
  @IsDateString()
  quoteDate: string;

  @ApiPropertyOptional({ description: 'ISO date or null.' })
  @IsOptional()
  @IsDateString()
  estimatedStartDate?: string | null;

  @ApiPropertyOptional({ description: 'ISO date or null.' })
  @IsOptional()
  @IsDateString()
  estimatedEndDate?: string | null;

  @ApiPropertyOptional({ description: 'Persisted document URL, or null.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  documentUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
