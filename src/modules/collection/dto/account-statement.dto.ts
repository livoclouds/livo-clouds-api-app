import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class AccountStatementDto {
  @ApiPropertyOptional({
    example: '2025-01-01',
    description: 'ISO date. Defaults to (today − 12 months) when both from and to are omitted.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2025-12-31',
    description: 'ISO date. Defaults to today when both from and to are omitted.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Calendar year filter on collection records.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1, description: 'Transactions page number.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  txPage?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 200, description: 'Transactions per page.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  txLimit?: number = 200;
}
