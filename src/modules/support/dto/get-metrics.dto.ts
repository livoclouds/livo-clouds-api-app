import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { SUPPORT_SLUG_MAX, SUPPORT_SLUG_PATTERN } from './article-slug.util';

export class GetMetricsDto {
  @ApiProperty({
    type: [String],
    maxItems: 100,
    description: 'Article slugs to fetch engagement metrics for.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(SUPPORT_SLUG_MAX, { each: true })
  @Matches(SUPPORT_SLUG_PATTERN, { each: true })
  slugs: string[];
}
