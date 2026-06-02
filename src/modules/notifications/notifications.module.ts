import { Module } from '@nestjs/common';
import { WebPushModule } from '../web-push/web-push.module';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsDevController } from './notifications.dev.controller';
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
  imports: [WebPushModule],
  controllers: [
    NotificationsController,
    MeNotificationsController,
    NotificationsSseController,
    // Dev-only; its handlers self-gate to non-production (return 404 in prod).
    NotificationsDevController,
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
