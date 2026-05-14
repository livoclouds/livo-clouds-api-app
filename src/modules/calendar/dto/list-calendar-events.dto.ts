import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListCalendarEventsDto {
  @ApiProperty({ example: '2026-05-01T00:00:00.000Z' })
  @IsDateString()
  @IsNotEmpty()
  from!: string;

  @ApiProperty({ example: '2026-05-31T23:59:59.999Z' })
  @IsDateString()
  @IsNotEmpty()
  to!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page number for the calendar events list.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 2000,
    default: 500,
    description:
      'Rows per page. Default covers any practical month-or-year window of events.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number = 500;
}
