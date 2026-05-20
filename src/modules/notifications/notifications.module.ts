import { Module } from '@nestjs/common';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsRetentionCron } from './notifications.cron';
import { NotificationsSseController } from './notifications.sse.controller';
import { NotificationsSseGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { AuthNotificationsListener } from './listeners/auth-notifications.listener';
import { CalendarNotificationsListener } from './listeners/calendar-notifications.listener';
import { ClassificationNotificationsListener } from './listeners/classification-notifications.listener';
import { ImportsNotificationsListener } from './listeners/imports-notifications.listener';
import { ReconciliationNotificationsListener } from './listeners/reconciliation-notifications.listener';
import { UsersNotificationsListener } from './listeners/users-notifications.listener';

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
    // Phase 3 — one @OnEvent listener per domain. Registering them as
    // providers is what makes @nestjs/event-emitter discover their handlers.
    ImportsNotificationsListener,
    ClassificationNotificationsListener,
    ReconciliationNotificationsListener,
    CalendarNotificationsListener,
    UsersNotificationsListener,
    AuthNotificationsListener,
  ],
  exports: [NotificationsService, NotificationsSseGateway],
})
export class NotificationsModule {}
