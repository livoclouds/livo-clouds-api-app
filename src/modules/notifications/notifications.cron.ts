import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATION_RETENTION_DAYS } from './notifications.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily retention sweep for the Notifications module. Notification rows are
 * hard-deleted once they pass the retention window; audit logs are a separate
 * model and are never touched here.
 */
@Injectable()
export class NotificationsRetentionCron {
  private readonly logger = new Logger(NotificationsRetentionCron.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs every day at 03:00 America/Mexico_City (a low-traffic window). A
   * failed run is logged and swallowed so the scheduler stays healthy; the
   * next day's run recovers the backlog.
   */
  @Cron('0 3 * * *', {
    name: 'notifications-retention',
    timeZone: 'America/Mexico_City',
  })
  async purgeExpiredNotifications(): Promise<void> {
    const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
    try {
      const { count } = await this.prisma.notification.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      this.logger.log(
        `notifications-retention: purged ${count} notification(s) older than ${NOTIFICATION_RETENTION_DAYS} days`,
      );
    } catch (err) {
      this.logger.error(
        `notifications-retention: purge failed: ${String(err)}`,
      );
    }
  }
}
