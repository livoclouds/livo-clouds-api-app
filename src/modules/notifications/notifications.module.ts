import { Module } from '@nestjs/common';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsRetentionCron } from './notifications.cron';
import { NotificationsSseController } from './notifications.sse.controller';
import { NotificationsSseGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [
    NotificationsController,
    MeNotificationsController,
    NotificationsSseController,
  ],
  providers: [
    NotificationsService,
    NotificationsSseGateway,
    NotificationsRetentionCron,
  ],
  exports: [NotificationsService, NotificationsSseGateway],
})
export class NotificationsModule {}
