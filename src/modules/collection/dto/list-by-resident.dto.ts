import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListByResidentDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page number for the resident collection history.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 600,
    default: 24,
    description:
      'Rows per page. Default of 24 covers a recent two-year window (~12 records/year per resident). Older history is reachable via higher page numbers.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  limit?: number = 24;
}
