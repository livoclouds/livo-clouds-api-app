import { ApiProperty } from '@nestjs/swagger';
import { NotificationSound } from '@prisma/client';
import { IsBoolean, IsEnum } from 'class-validator';

/**
 * Body for updating the current user's notification arrival-sound preference.
 * `soundEnabled: false` represents "Ninguno" (silent); `soundChoice` is still
 * stored so toggling back on restores the last pick.
 */
export class UpdateNotificationSoundDto {
  @ApiProperty({ description: 'Whether an arrival sound plays for new notifications.' })
  @IsBoolean()
  soundEnabled!: boolean;

  @ApiProperty({ enum: NotificationSound })
  @IsEnum(NotificationSound)
  soundChoice!: NotificationSound;
}
