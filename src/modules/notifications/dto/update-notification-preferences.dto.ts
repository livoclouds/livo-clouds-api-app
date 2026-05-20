import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    description:
      'Map of NotificationType to enabled flag. Unknown or disallowed keys ' +
      'are ignored by the service rather than rejected.',
    example: { IMPORT_WITH_WARNINGS: false, CALENDAR_EVENT_CANCELLED: true },
  })
  @IsObject()
  preferences!: Record<string, boolean>;
}
