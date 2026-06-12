import { ApiPropertyOptional } from '@nestjs/swagger';
import { QuotationCategory, QuotationStatus } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update of a request. Every field is optional. `status` and
 * `selectedQuotationId` are the reconciliation/selection levers; the service
 * validates `selectedQuotationId` against the request's own quotations (or
 * `null` to clear the selection). Photo arrays accept persisted URL strings —
 * the R2 upload itself is a separate concern handled by the storage module.
 */
export class UpdateQuotationRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: QuotationCategory })
  @IsOptional()
  @IsEnum(QuotationCategory)
  category?: QuotationCategory;

  @ApiPropertyOptional({ enum: QuotationStatus })
  @IsOptional()
  @IsEnum(QuotationStatus)
  status?: QuotationStatus;

  @ApiPropertyOptional({ description: 'ISO date or null.' })
  @IsOptional()
  @IsDateString()
  targetStartDate?: string | null;

  @ApiPropertyOptional({ description: 'ISO date or null.' })
  @IsOptional()
  @IsDateString()
  targetEndDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string;

  @ApiPropertyOptional({
    description:
      'Id of the winning quotation (must belong to this request), or null to clear.',
  })
  @IsOptional()
  @IsString()
  selectedQuotationId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  beforePhotos?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  afterPhotos?: string[];
}
