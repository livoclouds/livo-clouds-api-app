import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { EventTypeDto } from './create-calendar-event.dto';

export enum EventStatusDto {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

export class UpdateCalendarEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: EventTypeDto })
  @IsOptional()
  @IsEnum(EventTypeDto)
  eventType?: EventTypeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unitNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  residentId?: string;

  @ApiPropertyOptional({ enum: EventStatusDto })
  @IsOptional()
  @IsEnum(EventStatusDto)
  status?: EventStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Event-type-specific metadata (e.g. TerraceBookingMetadata)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
