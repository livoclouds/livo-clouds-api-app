import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class FinancialHealthDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 36,
    default: 12,
    description: 'How many trailing months of derived score history to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  historyMonths?: number = 12;
}
