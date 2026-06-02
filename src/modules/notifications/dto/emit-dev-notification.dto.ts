import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * Body for the dev-only "emit a notification to myself" endpoint. `type` must
 * be a valid {@link NotificationType}; the controller further restricts it to
 * role-matrix (`R1`) types that have a dev sample.
 */
export class EmitDevNotificationDto {
  @ApiProperty({
    enum: NotificationType,
    description: 'The notification type to fire to the current user.',
    example: NotificationType.IMPORT_COMPLETED,
  })
  @IsEnum(NotificationType)
  type!: NotificationType;
}
