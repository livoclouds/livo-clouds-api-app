import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppConversationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_BATCH_SIZE = 500;

export interface RetentionSweepResult {
  condominiumsScanned: number;
  conversationsAffected: number;
  messagesDeleted: number;
}

/**
 * Resolved-conversation message retention sweep (Phase 5).
 *
 * For every condominium, messages belonging to RESOLVED conversations whose
 * `resolvedAt` is older than `WhatsAppBotConfig.conversationRetentionDays` are
 * deleted. Conversation rows are kept — their metadata (status, counters,
 * timestamps) stays available for reporting and re-identification. Active
 * conversations and audit logs are never touched. The job is idempotent: a
 * re-run simply finds no remaining messages for already-swept conversations.
 * Gated behind `conversationRetentionDays > 0`.
 */
@Injectable()
export class WhatsAppRetentionService {
  private readonly logger = new Logger(WhatsAppRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sweep(now: Date = new Date()): Promise<RetentionSweepResult> {
    const configs = await this.prisma.whatsAppBotConfig.findMany({
      where: { conversationRetentionDays: { gt: 0 } },
      select: { condominiumId: true, conversationRetentionDays: true },
    });

    let conversationsAffected = 0;
    let messagesDeleted = 0;

    for (const config of configs) {
      const cutoff = new Date(
        now.getTime() - config.conversationRetentionDays * DAY_MS,
      );
      const staleConversations = await this.prisma.whatsAppConversation.findMany({
        where: {
          condominiumId: config.condominiumId,
          status: WhatsAppConversationStatus.RESOLVED,
          resolvedAt: { not: null, lt: cutoff },
        },
        select: { id: true },
      });
      if (staleConversations.length === 0) continue;

      const ids = staleConversations.map((c) => c.id);
      for (let i = 0; i < ids.length; i += CONVERSATION_BATCH_SIZE) {
        const batch = ids.slice(i, i + CONVERSATION_BATCH_SIZE);
        const deleted = await this.prisma.whatsAppMessage.deleteMany({
          where: { conversationId: { in: batch } },
        });
        messagesDeleted += deleted.count;
      }
      conversationsAffected += ids.length;
      this.logger.log(
        `[retention] condominium=${config.condominiumId} ` +
          `retentionDays=${config.conversationRetentionDays} ` +
          `conversations=${ids.length}`,
      );
    }

    this.logger.log(
      `[retention] sweep complete — condominiums=${configs.length} ` +
        `conversations=${conversationsAffected} messagesDeleted=${messagesDeleted}`,
    );
    return {
      condominiumsScanned: configs.length,
      conversationsAffected,
      messagesDeleted,
    };
  }
}
