import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListOverdueDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 500;

  @ApiPropertyOptional({
    description: 'Substring match (case-insensitive) on unit number, first name, last name.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Minimum debt threshold (decimal).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDebt?: number;
}
