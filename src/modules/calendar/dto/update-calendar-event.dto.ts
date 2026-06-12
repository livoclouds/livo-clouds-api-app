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

// CAL-011: how to handle an APPROVED transaction still linked to a terrace booking
// when that booking is cancelled — keep the recorded income, or reopen the payment
// back to reconciliation review.
export enum PaidLinkActionDto {
  KEEP = 'KEEP',
  REOPEN = 'REOPEN',
}

export class UpdateCalendarEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
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
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
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
  @MaxLength(5000)
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

  @ApiPropertyOptional({
    description:
      'CAL-006 optimistic lock: the event updatedAt the client edited against (ISO 8601). When sent and it no longer matches, the update is rejected with 409 STALE_OVERRIDE instead of silently overwriting concurrent changes (e.g. a reconciliation that flipped the booking PAID).',
  })
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({
    enum: PaidLinkActionDto,
    description:
      'CAL-011: required when cancelling a terrace booking that still has an APPROVED linked transaction. KEEP retains the recorded income; REOPEN sends the payment back to reconciliation review. Omitting it on such a cancel returns 409 PAID_BOOKING_LINKED.',
  })
  @IsOptional()
  @IsEnum(PaidLinkActionDto)
  paidLinkAction?: PaidLinkActionDto;
}
