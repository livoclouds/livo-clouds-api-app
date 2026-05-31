import { ApiProperty } from "@nestjs/swagger";
import { IsISO8601 } from "class-validator";

/**
 * Body for snoozing a notification. `snoozedUntil` is an absolute ISO 8601
 * instant computed client-side in the user's timezone; the service additionally
 * rejects non-future values. Un-snoozing uses a bodyless DELETE.
 */
export class SnoozeNotificationDto {
  @ApiProperty({
    description: "When the notification should resurface (ISO 8601, future)",
    example: "2026-06-01T09:00:00.000Z",
  })
  @IsISO8601()
  snoozedUntil!: string;
}
