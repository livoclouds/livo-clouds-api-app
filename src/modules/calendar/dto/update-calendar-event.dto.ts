import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CalendarEventVisibilityDto, EventTypeDto } from './create-calendar-event.dto';

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

  @ApiPropertyOptional({
    description:
      'RFC 5545 RRULE string. Send null to clear an existing series and revert to a single event. Sub-daily frequencies and TERRACE_BOOKING events are rejected.',
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
      'Optional IANA timezone override (Phase 5B). Send null to clear an override and revert to the condominium timezone.',
    example: 'America/New_York',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  @ApiPropertyOptional({
    enum: CalendarEventVisibilityDto,
    description:
      'Event visibility scope (Phase 5C). PUBLIC: visible to every calendar viewer. COUNCIL_ONLY: root + tenant_admin + read_only. PRIVATE: root + tenant_admin only.',
  })
  @IsOptional()
  @IsEnum(CalendarEventVisibilityDto)
  visibility?: CalendarEventVisibilityDto;
}
