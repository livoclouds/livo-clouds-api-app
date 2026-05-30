import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WebPushModule } from '../web-push/web-push.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppInternalCronController } from './whatsapp-internal-cron.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { WhatsAppNotificationPreferenceService } from './whatsapp-notification-preference.service';
import { WhatsAppNotificationDispatcherService } from './whatsapp-notification-dispatcher.service';
import { WhatsAppRenotifyScheduler } from './whatsapp-renotify.scheduler';
import { WhatsAppRetentionService } from './whatsapp-retention.service';
import { WhatsAppAnalyticsService } from './whatsapp-analytics.service';
import { WhatsAppIdentityCaptureService } from './whatsapp-identity-capture.service';
import { WhatsAppUnregisteredService } from './whatsapp-unregistered.service';
import { WhatsAppMediaService } from './whatsapp-media.service';
import { WhatsAppMediaRateLimitService } from './whatsapp-media-rate-limit.service';

@Module({
  imports: [AuditModule, WebPushModule],
  controllers: [
    WhatsAppController,
    WhatsAppWebhookController,
    WhatsAppInternalCronController,
  ],
  providers: [
    WhatsAppService,
    WhatsAppBotService,
    WhatsAppMetaClientService,
    WhatsAppNotificationPreferenceService,
    WhatsAppNotificationDispatcherService,
    WhatsAppRenotifyScheduler,
    WhatsAppRetentionService,
    WhatsAppAnalyticsService,
    WhatsAppIdentityCaptureService,
    WhatsAppUnregisteredService,
    WhatsAppMediaService,
    WhatsAppMediaRateLimitService,
  ],
})
export class WhatsAppModule {}
