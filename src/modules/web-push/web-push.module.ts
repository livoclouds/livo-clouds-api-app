import { Module } from '@nestjs/common';
import { WebPushService } from './web-push.service';

/**
 * Shared Web Push channel. Imported by any module that needs to deliver an OS
 * push notification (WhatsApp escalations, general notification fan-out).
 * PrismaService is provided globally; ConfigService comes from the root
 * ConfigModule, so this module only needs to expose the service.
 */
@Module({
  providers: [WebPushService],
  exports: [WebPushService],
})
export class WebPushModule {}
