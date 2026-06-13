import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { normalizeTerraceKeywordList } from '../../classification/terrace-keywords.util';

const MAX_TERRACE_GLOBAL_KEYWORDS = 20;
const MAX_TERRACE_GLOBAL_KEYWORD_LENGTH = 100;
// CAL-036: a 1–2 char keyword fires its substring signal on nearly every
// description, flooding the review queue with ambiguity noise. Require a
// meaningful stem; the matcher additionally word-boundary-matches short
// (≤4 char) keywords so they only fire on whole words.
const MIN_TERRACE_GLOBAL_KEYWORD_LENGTH = 3;

export class UpdateTerraceSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  terraceBookingEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  terraceRentalAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  terraceSecurityDepositAmount?: number;

  @ApiPropertyOptional({ description: 'HH:MM format, e.g. "10:00"' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'terraceDefaultStartTime must be in HH:MM format' })
  terraceDefaultStartTime?: string;

  @ApiPropertyOptional({ description: 'HH:MM format, e.g. "11:00"' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'terraceDefaultEndTime must be in HH:MM format' })
  terraceDefaultEndTime?: string;

  /**
   * Phase 5F (KI-004) — tenant-level keywords merged with hardcoded terrace terms
   * during Pass 0.5 bank-payment matching. Mirrors the per-event customKeywords caps
   * (max 20 entries, 100 chars each) for consistency. The Transform pipeline trims,
   * NFD-normalizes, lowercases, drops empties and dedupes before validation runs,
   * so the values that hit the database match what the matcher will compare against.
   */
  @ApiPropertyOptional({
    type: [String],
    description:
      'Tenant-level terrace keywords merged with hardcoded defaults and per-event customKeywords during Pass 0.5 matching.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : normalizeTerraceKeywordList(value)))
  @IsArray()
  @ArrayMaxSize(MAX_TERRACE_GLOBAL_KEYWORDS)
  @IsString({ each: true })
  @MinLength(MIN_TERRACE_GLOBAL_KEYWORD_LENGTH, {
    each: true,
    message: `each terrace keyword must be at least ${MIN_TERRACE_GLOBAL_KEYWORD_LENGTH} characters`,
  })
  @MaxLength(MAX_TERRACE_GLOBAL_KEYWORD_LENGTH, { each: true })
  terraceGlobalKeywords?: string[];
}
