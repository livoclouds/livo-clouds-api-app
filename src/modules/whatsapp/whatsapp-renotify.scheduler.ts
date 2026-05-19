import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppConversationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppNotificationDispatcherService } from './whatsapp-notification-dispatcher.service';

const MAX_BATCH_SIZE = 50;

export interface RenotifyScanResult {
  scanned: number;
  dispatched: number;
}

@Injectable()
export class WhatsAppRenotifyScheduler {
  private readonly logger = new Logger(WhatsAppRenotifyScheduler.name);

  constructor(
    private prisma: PrismaService,
    private dispatcher: WhatsAppNotificationDispatcherService,
  ) {}

  async scanAndReNotify(): Promise<RenotifyScanResult> {
    const candidates = await this.prisma.whatsAppConversation.findMany({
      where: {
        status: WhatsAppConversationStatus.ESCALATED,
        firstNotifiedAt: { not: null },
        reNotifiedAt: null,
      },
      select: {
        id: true,
        condominiumId: true,
        firstNotifiedAt: true,
      },
      take: MAX_BATCH_SIZE,
    });
    if (candidates.length === 0) return { scanned: 0, dispatched: 0 };

    const configByCondo = new Map<string, number>();
    const condominiumIds = Array.from(new Set(candidates.map((c) => c.condominiumId)));
    const configs = await this.prisma.whatsAppBotConfig.findMany({
      where: { condominiumId: { in: condominiumIds } },
      select: { condominiumId: true, reNotifyAfterMinutes: true },
    });
    for (const cfg of configs) {
      configByCondo.set(cfg.condominiumId, cfg.reNotifyAfterMinutes);
    }

    const overrides = await this.prisma.whatsAppNotificationPreference.findMany({
      where: { condominiumId: { in: condominiumIds }, reNotifyAfterMinutes: { not: null } },
      select: { condominiumId: true, reNotifyAfterMinutes: true },
    });
    const overrideByCondo = new Map<string, number>();
    for (const row of overrides) {
      if (row.reNotifyAfterMinutes == null) continue;
      const current = overrideByCondo.get(row.condominiumId);
      if (current == null || row.reNotifyAfterMinutes < current) {
        overrideByCondo.set(row.condominiumId, row.reNotifyAfterMinutes);
      }
    }

    const now = Date.now();
    const due = candidates.filter((c) => {
      const overrideMin = overrideByCondo.get(c.condominiumId);
      const minutes = overrideMin ?? configByCondo.get(c.condominiumId) ?? 5;
      const elapsedMs = now - (c.firstNotifiedAt?.getTime() ?? now);
      return elapsedMs >= minutes * 60_000;
    });
    if (due.length === 0) return { scanned: candidates.length, dispatched: 0 };

    this.logger.log(`[scanAndReNotify] dispatching re-notify for ${due.length} conversation(s)`);
    let dispatched = 0;
    for (const c of due) {
      try {
        await this.dispatcher.dispatchReNotification(c.id);
        dispatched += 1;
      } catch (err) {
        this.logger.error(
          `[scanAndReNotify] conversation=${c.id} failed: ${(err as Error).message}`,
        );
      }
    }
    return { scanned: candidates.length, dispatched };
  }
}
