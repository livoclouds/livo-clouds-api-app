import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  UserRole,
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppNotifyChannel,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decrypt } from '../../common/utils/encryption.util';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { WebPushService } from '../web-push/web-push.service';

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface PreferenceForDispatch {
  id: string;
  userId: string;
  notifyChannel: WhatsAppNotifyChannel;
  notifyOnEscalation: boolean;
  personalPhoneNumber: string | null;
  personalPhoneVerifiedAt: Date | null;
  pushSubscriptionJson: Prisma.JsonValue;
}

@Injectable()
export class WhatsAppNotificationDispatcherService {
  private readonly logger = new Logger(WhatsAppNotificationDispatcherService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private metaClient: WhatsAppMetaClientService,
    private pushService: WebPushService,
  ) {}

  async dispatchEscalation(conversationId: string): Promise<void> {
    const conversation = await this.prisma.whatsAppConversation.findUnique({
      where: { id: conversationId },
      include: {
        resident: { select: { firstName: true, lastName: true, unitNumber: true } },
      },
    });
    if (!conversation || conversation.status !== WhatsAppConversationStatus.ESCALATED) {
      return;
    }

    const preferences = await this.loadAdminPreferences(conversation.condominiumId);
    if (preferences.length === 0) {
      this.logger.log(
        `[dispatchEscalation] conversation=${conversationId} no eligible admin preferences`,
      );
    }

    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId: conversation.condominiumId },
    });
    if (!credential || credential.status !== 'ACTIVE') {
      this.logger.warn(
        `[dispatchEscalation] conversation=${conversationId} credential missing/inactive — skipping`,
      );
      return;
    }
    const slug = await this.resolveSlug(conversation.condominiumId);

    const subject = this.buildSubject(conversation);
    const deepLink = this.buildDeepLink(slug, conversationId);
    const messageText = this.buildEscalationText(subject, deepLink);

    await Promise.all(
      preferences.map((pref) =>
        this.notifyAdmin({
          preference: pref,
          credential,
          subject,
          deepLink,
          messageText,
          context: 'escalation',
          conversationId,
        }),
      ),
    );

    await this.prisma.whatsAppConversation.updateMany({
      where: { id: conversationId, firstNotifiedAt: null },
      data: { firstNotifiedAt: new Date() },
    });
  }

  async dispatchReNotification(conversationId: string): Promise<void> {
    const result = await this.prisma.whatsAppConversation.updateMany({
      where: {
        id: conversationId,
        status: WhatsAppConversationStatus.ESCALATED,
        reNotifiedAt: null,
      },
      data: { reNotifiedAt: new Date() },
    });
    if (result.count === 0) return;

    const conversation = await this.prisma.whatsAppConversation.findUnique({
      where: { id: conversationId },
      include: {
        resident: { select: { firstName: true, lastName: true, unitNumber: true } },
      },
    });
    if (!conversation) return;

    const preferences = await this.loadAdminPreferences(conversation.condominiumId);
    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId: conversation.condominiumId },
    });
    if (!credential || credential.status !== 'ACTIVE') return;
    const slug = await this.resolveSlug(conversation.condominiumId);

    const subject = this.buildSubject(conversation);
    const deepLink = this.buildDeepLink(slug, conversationId);
    const messageText = this.buildReNotifyText(subject, deepLink);

    await Promise.all(
      preferences.map((pref) =>
        this.notifyAdmin({
          preference: pref,
          credential,
          subject,
          deepLink,
          messageText,
          context: 're-notification',
          conversationId,
        }),
      ),
    );

    await this.sendBeRightWithYou(conversation, credential);
  }

  private async sendBeRightWithYou(
    conversation: { id: string; condominiumId: string; phoneNumber: string; beRightWithYouSentAt: Date | null },
    credential: {
      phoneNumberId: string;
      accessTokenCiphertext: string;
      accessTokenIv: string;
      accessTokenAuthTag: string;
    },
  ): Promise<void> {
    if (conversation.beRightWithYouSentAt) return;

    const botConfig = await this.prisma.whatsAppBotConfig.findUnique({
      where: { condominiumId: conversation.condominiumId },
      select: { beRightWithYouMessage: true },
    });
    const text = botConfig?.beRightWithYouMessage?.trim();
    if (!text) return;

    const inServiceWindow = await this.isResidentServiceWindowOpen(conversation.id);

    try {
      const accessToken = this.decryptToken(credential);
      let metaMessageId: string;
      if (inServiceWindow) {
        const result = await this.metaClient.sendTextMessage(
          credential.phoneNumberId,
          accessToken,
          conversation.phoneNumber,
          text,
        );
        metaMessageId = result.messageId || `system-brwy-${Date.now()}`;
      } else {
        this.logger.log(
          `[beRightWithYou] conversation=${conversation.id} skipped — outside 24h resident window`,
        );
        return;
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

      await this.prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { beRightWithYouSentAt: new Date(), lastOutboundAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `[beRightWithYou] conversation=${conversation.id} failed: ${(err as Error).message}`,
      );
    }
  }

  private async loadAdminPreferences(condominiumId: string): Promise<PreferenceForDispatch[]> {
    const rows = await this.prisma.whatsAppNotificationPreference.findMany({
      where: {
        condominiumId,
        notifyOnEscalation: true,
        user: {
          isActive: true,
          deletedAt: null,
          role: { in: [UserRole.ROOT, UserRole.TENANT_ADMIN] },
        },
      },
      select: {
        id: true,
        userId: true,
        notifyChannel: true,
        notifyOnEscalation: true,
        personalPhoneNumber: true,
        personalPhoneVerifiedAt: true,
        pushSubscriptionJson: true,
      },
    });
    return rows.filter((r) => r.notifyChannel !== WhatsAppNotifyChannel.NONE);
  }

  private async notifyAdmin(args: {
    preference: PreferenceForDispatch;
    credential: {
      phoneNumberId: string;
      accessTokenCiphertext: string;
      accessTokenIv: string;
      accessTokenAuthTag: string;
    };
    subject: string;
    deepLink: string;
    messageText: string;
    context: string;
    conversationId: string;
  }): Promise<void> {
    const { preference, credential, subject, deepLink, messageText, context, conversationId } =
      args;

    const wantsWhatsApp =
      preference.notifyChannel === WhatsAppNotifyChannel.WHATSAPP ||
      preference.notifyChannel === WhatsAppNotifyChannel.BOTH;
    const wantsPush =
      preference.notifyChannel === WhatsAppNotifyChannel.PUSH ||
      preference.notifyChannel === WhatsAppNotifyChannel.BOTH;

    // Web Push (Phase 5) — supplementary channel. A stable per-conversation tag
    // makes a re-notification replace the original alert instead of stacking.
    if (wantsPush) {
      const isReNotify = context === 're-notification';
      await this.pushService.sendToPreference(
        preference.id,
        preference.pushSubscriptionJson,
        {
          title: isReNotify ? 'Recordatorio de conversación' : 'Conversación escalada',
          body: isReNotify
            ? `${subject} sigue esperando atención`
            : `${subject} necesita atención`,
          tag: `whatsapp-conversation-${conversationId}`,
          url: `/communications/${conversationId}`,
        },
      );
    }

    if (!wantsWhatsApp) return;
    if (!preference.personalPhoneNumber || !preference.personalPhoneVerifiedAt) {
      this.logger.log(
        `[notifyAdmin] prefId=${preference.id} no verified personal phone — skipping ${context}`,
      );
      return;
    }

    try {
      const accessToken = this.decryptToken(credential);
      const windowOpen = await this.isAdminServiceWindowOpen(
        preference.personalPhoneNumber,
      );

      if (windowOpen) {
        await this.metaClient.sendTextMessage(
          credential.phoneNumberId,
          accessToken,
          preference.personalPhoneNumber,
          messageText,
        );
        this.logger.log(
          `[notifyAdmin] prefId=${preference.id} free-form ${context} sent`,
        );
      } else {
        const templateName = this.configService.get<string>(
          'whatsapp.escalationTemplateName',
          'escalation_notification',
        );
        const languageCode = this.configService.get<string>(
          'whatsapp.escalationTemplateLanguage',
          'es_MX',
        );
        await this.metaClient.sendTemplateMessage(
          credential.phoneNumberId,
          accessToken,
          preference.personalPhoneNumber,
          templateName,
          languageCode,
          [
            { type: 'text', text: subject },
            { type: 'text', text: deepLink },
          ],
        );
        this.logger.log(
          `[notifyAdmin] prefId=${preference.id} template ${context} sent (window closed)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[notifyAdmin] prefId=${preference.id} ${context} failed: ${(err as Error).message}`,
      );
    }
  }

  private async isAdminServiceWindowOpen(personalPhoneNumber: string): Promise<boolean> {
    const since = new Date(Date.now() - SERVICE_WINDOW_MS);
    const recentInbound = await this.prisma.whatsAppMessage.findFirst({
      where: {
        direction: WhatsAppMessageDirection.INBOUND,
        createdAt: { gte: since },
        conversation: {
          isSystemChannel: true,
          phoneNumber: personalPhoneNumber,
        },
      },
      select: { id: true },
    });
    return Boolean(recentInbound);
  }

  private async isResidentServiceWindowOpen(conversationId: string): Promise<boolean> {
    const since = new Date(Date.now() - SERVICE_WINDOW_MS);
    const recentInbound = await this.prisma.whatsAppMessage.findFirst({
      where: {
        conversationId,
        direction: WhatsAppMessageDirection.INBOUND,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    return Boolean(recentInbound);
  }

  private async resolveSlug(condominiumId: string): Promise<string> {
    const condo = await this.prisma.condominium.findUnique({
      where: { id: condominiumId },
      select: { slug: true },
    });
    return condo?.slug ?? '';
  }

  private buildSubject(conversation: {
    contactName: string | null;
    phoneNumber: string;
    resident: { firstName: string; lastName: string; unitNumber: string | null } | null;
  }): string {
    if (conversation.resident?.unitNumber) {
      return `Casa ${conversation.resident.unitNumber}`;
    }
    if (conversation.resident) {
      return `${conversation.resident.firstName} ${conversation.resident.lastName}`.trim();
    }
    if (conversation.contactName) return conversation.contactName;
    return this.redactPhone(conversation.phoneNumber);
  }

  private buildDeepLink(slug: string, conversationId: string): string {
    const base = this.configService
      .get<string>('whatsapp.webAppUrl', 'http://localhost:3000')
      .replace(/\/+$/, '');
    const path = slug
      ? `${base}/${slug}/communications/${conversationId}`
      : `${base}/communications/${conversationId}`;
    return path;
  }

  private buildEscalationText(subject: string, deepLink: string): string {
    return `🔔 ${subject} necesita atención.\n\nToma el chat en LivoClouds:\n${deepLink}`;
  }

  private buildReNotifyText(subject: string, deepLink: string): string {
    return `⏰ Recordatorio: ${subject} sigue esperando atención.\n\nToma el chat:\n${deepLink}`;
  }

  private redactPhone(phone: string): string {
    if (!phone) return '';
    if (phone.length <= 4) return phone;
    return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
  }

  private decryptToken(credential: {
    accessTokenCiphertext: string;
    accessTokenIv: string;
    accessTokenAuthTag: string;
  }): string {
    const key = this.configService.get<string>('whatsapp.encryptionKey', '');
    return decrypt(
      credential.accessTokenCiphertext,
      credential.accessTokenIv,
      credential.accessTokenAuthTag,
      key,
    );
  }
}
