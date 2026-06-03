import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Body for updating the current user's "Do Not Disturb" flag. Persisted on the
 * same single-row settings record as the arrival-sound preference.
 */
export class UpdateNotificationDndDto {
  @ApiProperty({
    description:
      'When true, the web mutes the in-app arrival toast for this user.',
  })
  @IsBoolean()
  dnd!: boolean;
}
