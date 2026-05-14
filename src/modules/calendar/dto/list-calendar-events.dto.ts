import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
