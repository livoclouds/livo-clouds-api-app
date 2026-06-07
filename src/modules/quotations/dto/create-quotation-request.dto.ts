import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuotationCategory } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payload to open a new quotation request. Mirrors the fields the web app's
 * create modal sends (title, description, category, target dates, comments).
 * `status` is always `received` on creation — set by the service, never the
 * client.
 */
export class CreateQuotationRequestDto {
  @ApiProperty({ example: 'Repintar fachada principal' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'La pintura del lobby está descascarada.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: QuotationCategory })
  @IsEnum(QuotationCategory)
  category: QuotationCategory;

  @ApiPropertyOptional({ example: '2026-06-01', description: 'ISO date or null.' })
  @IsOptional()
  @IsDateString()
  targetStartDate?: string | null;

  @ApiPropertyOptional({ example: '2026-06-15', description: 'ISO date or null.' })
  @IsOptional()
  @IsDateString()
  targetEndDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string;
}
