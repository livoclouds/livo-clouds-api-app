import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListPettyCashDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page number for the petty-cash movements list.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1000,
    default: 200,
    description:
      'Rows per page. Default covers roughly one year of petty-cash activity for a typical tenant in a single page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 200;
}
