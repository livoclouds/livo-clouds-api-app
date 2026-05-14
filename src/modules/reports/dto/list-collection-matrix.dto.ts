import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListCollectionMatrixDto {
  @ApiPropertyOptional({
    minimum: 2000,
    maximum: 2100,
    description:
      'Calendar year filter for collection records. Defaults to the current year when omitted.',
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
    description: 'Page number — paginates residents (one matrix row per resident).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1000,
    default: 500,
    description:
      'Residents per page. Default fits every current tenant in a single page (largest seed < 300 residents).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 500;
}
