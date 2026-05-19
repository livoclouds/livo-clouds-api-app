import { Injectable, Logger } from '@nestjs/common';
import {
  WhatsAppBotConfig,
  WhatsAppConversation,
  WhatsAppConversationStatus,
  WhatsAppFaq,
  WhatsAppMessage,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decrypt } from '../../common/utils/encryption.util';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { ConfigService } from '@nestjs/config';

interface BotContext {
  conversation: WhatsAppConversation;
  inboundMessage: WhatsAppMessage;
  botConfig: WhatsAppBotConfig;
  phoneNumberId: string;
  accessTokenCiphertext: string;
  accessTokenIv: string;
  accessTokenAuthTag: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class WhatsAppBotService {
  private readonly logger = new Logger(WhatsAppBotService.name);

  constructor(
    private prisma: PrismaService,
    private metaClient: WhatsAppMetaClientService,
    private configService: ConfigService,
  ) {}

  async processBotPipeline(ctx: BotContext): Promise<void> {
    const { conversation, botConfig } = ctx;
    const messageText = ctx.inboundMessage.textContent ?? '';

    // Stage 1: Bot enabled check
    if (!botConfig.isEnabled) {
      await this.escalate(ctx, botConfig.escalationMessage);
      return;
    }

    // Stage 2: Whitelist check
    if (
      botConfig.whitelistEnabled &&
      !botConfig.whitelistedPhoneNumbers.includes(conversation.phoneNumber)
    ) {
      await this.escalate(ctx, botConfig.escalationMessage);
      return;
    }

    // Stage 4: Escalation keyword check
    const normalizedMessage = normalize(messageText);
    const hasEscalationKeyword = botConfig.escalationKeywords.some((keyword) => {
      const pattern = new RegExp(`\\b${escapeRegex(normalize(keyword))}\\b`, 'i');
      return pattern.test(normalizedMessage);
    });

    if (hasEscalationKeyword) {
      await this.escalate(ctx, botConfig.escalationMessage);
      return;
    }

    // Stage 6: FAQ matching
    const matchedFaq = await this.matchFaq(conversation.condominiumId, messageText);

    if (matchedFaq) {
      await this.sendBotMessage(ctx, matchedFaq.answer);
      await this.prisma.whatsAppFaq.update({
        where: { id: matchedFaq.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      await this.prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { consecutiveFaqMisses: 0, lastOutboundAt: new Date() },
      });
      return;
    }

    // Stage 7: Miss handling
    if (conversation.consecutiveFaqMisses === 0) {
      await this.sendBotMessage(ctx, botConfig.fallbackMessage);
      await this.prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { consecutiveFaqMisses: 1, lastOutboundAt: new Date() },
      });
    } else {
      await this.escalate(ctx, botConfig.escalationMessage);
    }
  }

  async matchFaq(condominiumId: string, messageText: string): Promise<WhatsAppFaq | null> {
    const faqs = await this.prisma.whatsAppFaq.findMany({
      where: { condominiumId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }],
    });

    if (faqs.length === 0) return null;

    const normalizedMessage = normalize(messageText);

    // Flatten triggers sorted by length DESC then sortOrder ASC for priority
    const candidates: { trigger: string; faq: WhatsAppFaq }[] = [];
    for (const faq of faqs) {
      for (const trigger of faq.triggers) {
        candidates.push({ trigger, faq });
      }
    }
    candidates.sort((a, b) => b.trigger.length - a.trigger.length || a.faq.sortOrder - b.faq.sortOrder);

    for (const { trigger, faq } of candidates) {
      const pattern = new RegExp(`\\b${escapeRegex(normalize(trigger))}\\b`, 'i');
      if (pattern.test(normalizedMessage)) {
        return faq;
      }
    }

    return null;
  }

  private async escalate(ctx: BotContext, escalationMessage: string): Promise<void> {
    const { conversation } = ctx;

    await this.sendBotMessage(ctx, escalationMessage);

    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        status: WhatsAppConversationStatus.ESCALATED,
        escalatedAt: new Date(),
        consecutiveFaqMisses: 0,
        lastOutboundAt: new Date(),
      },
    });
  }

  private async sendBotMessage(ctx: BotContext, text: string): Promise<void> {
    const { conversation, phoneNumberId, accessTokenCiphertext, accessTokenIv, accessTokenAuthTag } = ctx;
    const encryptionKey = this.configService.get<string>('whatsapp.encryptionKey', '');

    let accessToken: string;
    try {
      accessToken = decrypt(accessTokenCiphertext, accessTokenIv, accessTokenAuthTag, encryptionKey);
    } catch (err) {
      this.logger.error('Failed to decrypt access token for bot send');
      throw err;
    }

    let metaMessageId: string;
    try {
      const result = await this.metaClient.sendTextMessage(
        phoneNumberId,
        accessToken,
        conversation.phoneNumber,
        text,
      );
      metaMessageId = result.messageId || `bot-${Date.now()}`;
    } catch (err) {
      this.logger.error('Failed to send bot message via Meta API', (err as Error).message);
      metaMessageId = `bot-failed-${Date.now()}`;
    }

    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: WhatsAppMessageDirection.OUTBOUND,
        messageType: WhatsAppMessageType.TEXT,
        textContent: null,
        sentByBot: true,
        metaMessageId,
        status: WhatsAppMessageStatus.SENT,
      },
    });
  }
}
