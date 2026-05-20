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
import { WhatsAppNotificationDispatcherService } from './whatsapp-notification-dispatcher.service';
import { WhatsAppIdentityCaptureService } from './whatsapp-identity-capture.service';
import { ConfigService } from '@nestjs/config';
import {
  getNextBusinessWindow,
  isWithinBusinessHours,
  renderOffHoursMessage,
} from './business-hours.util';

// Hardcoded for Phase 3; moves to WhatsAppBotConfig as a configurable field in Phase 4.
const IDENTITY_CONFIRMATION_MESSAGE =
  'Listo, te identifiqué como residente registrado. ¡Gracias!';

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
    private notificationDispatcher: WhatsAppNotificationDispatcherService,
    private identityCapture: WhatsAppIdentityCaptureService,
  ) {}

  async processBotPipeline(ctx: BotContext): Promise<void> {
    let { conversation } = ctx;
    const { botConfig } = ctx;
    const messageText = ctx.inboundMessage.textContent ?? '';

    // Stage 0: Identity capture (Pass 3). Runs before bot answering so a
    // successful auto-link routes the rest of the pipeline as a known resident.
    if (conversation.unregisteredContactId && !conversation.residentId) {
      const { matchedResidentId } = await this.identityCapture.tryCaptureIdentity({
        conversation,
        inboundText: ctx.inboundMessage.textContent,
      });
      if (matchedResidentId) {
        const refreshed = await this.prisma.whatsAppConversation.findUnique({
          where: { id: conversation.id },
        });
        if (refreshed) {
          conversation = refreshed;
          ctx.conversation = refreshed;
        }
        await this.sendBotMessage(ctx, IDENTITY_CONFIRMATION_MESSAGE);
      }
    }

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
      const answer = await this.composeFaqAnswer(
        conversation.condominiumId,
        matchedFaq.answer,
        botConfig,
      );
      await this.sendBotMessage(ctx, answer);
      await this.prisma.whatsAppFaq.update({
        where: { id: matchedFaq.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      await this.prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { consecutiveFaqMisses: 0, lastOutboundAt: new Date() },
      });
      await this.maybeAppendIdentityPrompt(ctx);
      return;
    }

    // Stage 7: Miss handling
    if (conversation.consecutiveFaqMisses === 0) {
      await this.sendBotMessage(ctx, botConfig.fallbackMessage);
      await this.prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { consecutiveFaqMisses: 1, lastOutboundAt: new Date() },
      });
      await this.maybeAppendIdentityPrompt(ctx);
    } else {
      await this.escalate(ctx, botConfig.escalationMessage);
    }
  }

  /**
   * Sends the one-time identity-capture prompt to an unregistered contact after
   * the bot has answered. Idempotent: skips if a unit was already captured or
   * the prompt was already sent (tracked by identityPromptSentAt).
   */
  private async maybeAppendIdentityPrompt(ctx: BotContext): Promise<void> {
    const { conversation, botConfig } = ctx;
    if (!conversation.unregisteredContactId || !botConfig.identityCaptureEnabled) {
      return;
    }

    const prompt = botConfig.identityCapturePrompt?.trim();
    if (!prompt) return;

    const contact = await this.prisma.whatsAppUnregisteredContact.findUnique({
      where: { id: conversation.unregisteredContactId },
    });
    if (!contact || contact.capturedUnitNumber || contact.identityPromptSentAt) {
      return;
    }

    await this.sendBotMessage(ctx, prompt);
    await this.prisma.whatsAppUnregisteredContact.update({
      where: { id: contact.id },
      data: { identityPromptSentAt: new Date() },
    });
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

  /**
   * Appends the configured off-hours notice to a FAQ answer when the inbound
   * message is handled outside the condominium's business hours. The bot still
   * answers the resident — the notice is only a postfix, never a replacement.
   * Within business hours (or when business hours are not configured) the
   * answer is returned untouched.
   */
  private async composeFaqAnswer(
    condominiumId: string,
    answer: string,
    botConfig: WhatsAppBotConfig,
  ): Promise<string> {
    const settings = await this.prisma.condominiumSettings.findUnique({
      where: { condominiumId },
      select: { businessHours: true, timezone: true },
    });
    if (!settings) return answer;

    const tz = settings.timezone ?? 'America/Monterrey';
    const now = new Date();
    if (isWithinBusinessHours(now, settings.businessHours, tz)) {
      return answer;
    }

    const template = botConfig.offHoursMessage?.trim();
    if (!template) return answer;

    const window = getNextBusinessWindow(now, settings.businessHours, tz);
    const postfix = window
      ? renderOffHoursMessage(template, window)
      : template.replace(/\{\{\s*next(Day|Time)\s*\}\}/gi, '').trim();
    if (!postfix) return answer;

    return `${answer}\n\n${postfix}`;
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
        firstNotifiedAt: null,
        reNotifiedAt: null,
        beRightWithYouSentAt: null,
      },
    });

    this.notificationDispatcher
      .dispatchEscalation(conversation.id)
      .catch((err) =>
        this.logger.error(
          `[escalate] dispatchEscalation failed for ${conversation.id}: ${(err as Error).message}`,
        ),
      );
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
