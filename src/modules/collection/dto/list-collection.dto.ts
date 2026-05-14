import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListCollectionDto {
  @ApiPropertyOptional({
    minimum: 2000,
    maximum: 2100,
    description:
      'Calendar year filter. Defaults to the current year when omitted.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page number for the collection records list.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1200,
    default: 600,
    description:
      'Rows per page. Default fits a typical condominium (~50 residents × 12 months) in a single page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1200)
  limit?: number = 600;
}
