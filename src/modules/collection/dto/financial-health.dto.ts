import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class FinancialHealthDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 36,
    default: 12,
    description:
      'How many trailing months of derived score history to return (UTC calendar ' +
      'months). Clamped to 1–36; months with no records are skipped, so fewer points ' +
      'than requested may come back — see `historyMeta` in the response for the ' +
      'requested-vs-returned breakdown.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  historyMonths?: number = 12;
}
