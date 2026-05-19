import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppInternalCronController } from './whatsapp-internal-cron.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { WhatsAppNotificationPreferenceService } from './whatsapp-notification-preference.service';
import { WhatsAppNotificationDispatcherService } from './whatsapp-notification-dispatcher.service';
import { WhatsAppRenotifyScheduler } from './whatsapp-renotify.scheduler';

@Module({
  imports: [AuditModule],
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
  ],
})
export class WhatsAppModule {}
