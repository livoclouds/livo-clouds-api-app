import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { QuotationCategory, QuotationStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Query params for the requests list. `q` is a case-insensitive substring match
 * over title + description. Pagination defaults cover a typical tenant in one
 * page (a condominium rarely has many open requests at once).
 */
export class ListQuotationsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ enum: QuotationStatus })
  @IsOptional()
  @IsEnum(QuotationStatus)
  status?: QuotationStatus;

  @ApiPropertyOptional({ enum: QuotationCategory })
  @IsOptional()
  @IsEnum(QuotationCategory)
  category?: QuotationCategory;

  @ApiPropertyOptional({ description: 'Substring match on title + description.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
