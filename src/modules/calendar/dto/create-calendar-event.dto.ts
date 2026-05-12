import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export enum EventTypeDto {
  TERRACE_BOOKING = 'TERRACE_BOOKING',
  ASSEMBLY = 'ASSEMBLY',
  COUNCIL_MEETING = 'COUNCIL_MEETING',
  MAINTENANCE = 'MAINTENANCE',
  PROVIDER = 'PROVIDER',
  GENERAL = 'GENERAL',
}

export class CreateCalendarEventDto {
  @ApiProperty({ example: 'Reservación Terraza - Familia García' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional({ example: 'Cumpleaños 15 años' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: EventTypeDto, default: EventTypeDto.GENERAL })
  @IsEnum(EventTypeDto)
  eventType: EventTypeDto;

  @ApiProperty({ example: '2026-05-20T18:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-05-20T23:00:00.000Z' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional({ example: 'Terraza A' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 'A-12' })
  @IsOptional()
  @IsString()
  unitNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  residentId?: string;

  @ApiPropertyOptional({ example: 'Confirmar con seguridad el acceso de proveedores' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Event-type-specific metadata (e.g. TerraceBookingMetadata)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
