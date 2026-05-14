import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

  @ApiPropertyOptional({
    description:
      'RFC 5545 RRULE string defining a recurring series. Must include UNTIL or COUNT. Sub-daily frequencies and TERRACE_BOOKING events are rejected. Omit or send null for a single-occurrence event.',
    example: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T235959Z',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  recurrenceRule?: string | null;

  @ApiPropertyOptional({
    description:
      'Reserved for future per-occurrence exception support. Phase 5A does not read or write this field; consumers should leave it unset.',
  })
  @IsOptional()
  @IsUUID()
  parentEventId?: string | null;

  @ApiPropertyOptional({
    description:
      'Optional IANA timezone override (Phase 5B). When set, list/detail rendering uses this zone instead of the condominium timezone. Omit or send null to inherit the condominium timezone.',
    example: 'America/New_York',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;
}
