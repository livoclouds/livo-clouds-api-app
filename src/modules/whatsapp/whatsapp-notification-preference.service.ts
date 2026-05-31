import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WhatsAppNotifyChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../../common/types';
import { decrypt } from '../../common/utils/encryption.util';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WhatsAppNotificationPreferenceService {
  private readonly logger = new Logger(WhatsAppNotificationPreferenceService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private auditService: AuditService,
    private metaClient: WhatsAppMetaClientService,
  ) {}

  async getForCurrentUser(condominiumId: string, userId: string) {
    const preference = await this.prisma.whatsAppNotificationPreference.upsert({
      where: { userId_condominiumId: { userId, condominiumId } },
      create: { userId, condominiumId },
      update: {},
    });
    return preference;
  }

  async updateForCurrentUser(
    condominiumId: string,
    user: JwtPayload,
    dto: UpdateNotificationPreferenceDto,
  ) {
    const before = await this.getForCurrentUser(condominiumId, user.sub);

    const data: Prisma.WhatsAppNotificationPreferenceUpdateInput = {};

    if (dto.notifyOnEscalation !== undefined) {
      data.notifyOnEscalation = dto.notifyOnEscalation;
    }
    if (dto.notifyChannel !== undefined) {
      data.notifyChannel = dto.notifyChannel;
    }
    if (dto.reNotifyAfterMinutes !== undefined) {
      data.reNotifyAfterMinutes = dto.reNotifyAfterMinutes;
    }
    if (dto.personalPhoneNumber !== undefined) {
      const normalized = dto.personalPhoneNumber?.trim() || null;
      if (normalized && normalized !== before.personalPhoneNumber) {
        await this.ensurePhoneNotInUse(condominiumId, normalized, user.sub);
      }
      data.personalPhoneNumber = normalized;
      if (normalized !== before.personalPhoneNumber) {
        data.personalPhoneVerifiedAt = null;
      }
    }

    const updated = await this.prisma.whatsAppNotificationPreference.update({
      where: { id: before.id },
      data,
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_NOTIFICATION_PREFERENCE_UPDATED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppNotificationPreference',
      entityId: updated.id,
      result: 'SUCCESS',
      description: 'Notification preference updated',
      beforeState: this.redactedSnapshot(before),
      afterState: this.redactedSnapshot(updated),
    });

    return updated;
  }

  async sendTestWhatsApp(
    condominiumId: string,
    userId: string,
    overridePhone?: string,
  ): Promise<{ ok: boolean; via: 'free-form' | 'template' | 'none'; errorMessage?: string }> {
    const preference = await this.getForCurrentUser(condominiumId, userId);
    const target = overridePhone?.trim() || preference.personalPhoneNumber;
    if (!target) {
      throw new BadRequestException('No personal phone number configured');
    }

    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId },
    });
    if (!credential || credential.status !== 'ACTIVE') {
      throw new BadRequestException('WhatsApp credential is not active for this condominium');
    }

    const encryptionKey = this.configService.get<string>('whatsapp.encryptionKey', '');
    const accessToken = decrypt(
      credential.accessTokenCiphertext,
      credential.accessTokenIv,
      credential.accessTokenAuthTag,
      encryptionKey,
    );

    const windowOpen = await this.isAdminServiceWindowOpen(target);
    const subject = 'Prueba de notificación';
    const body = '🔔 Prueba de notificación — LivoClouds. Este es un mensaje de prueba.';

    try {
      if (windowOpen) {
        await this.metaClient.sendTextMessage(
          credential.phoneNumberId,
          accessToken,
          target,
          body,
        );
        return { ok: true, via: 'free-form' };
      }
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
        target,
        templateName,
        languageCode,
        [
          { type: 'text', text: subject },
          { type: 'text', text: 'LivoClouds — notificación de prueba' },
        ],
      );
      return { ok: true, via: 'template' };
    } catch (err) {
      this.logger.error(`Test notification failed: ${(err as Error).message}`);
      return { ok: false, via: 'none', errorMessage: (err as Error).message };
    }
  }

  /**
   * Register (or refresh) a Web Push subscription for the current admin's device
   * (notifications iter2 — multi-device).
   *
   * The payload is validated and reduced to the canonical Web Push shape before
   * persistence. Subscriptions are upserted by their globally unique `endpoint`,
   * so a phone and a desktop coexist as separate rows for the same
   * (userId, condominiumId); re-registering the same browser refreshes its keys
   * and `lastSeenAt` instead of creating a duplicate. The deprecated single
   * `pushSubscriptionJson` field is no longer written.
   */
  async savePushSubscription(
    condominiumId: string,
    userId: string,
    subscription: Record<string, unknown> | undefined,
  ) {
    const validated = this.validatePushSubscription(subscription);
    const saved = await this.prisma.pushSubscription.upsert({
      where: { endpoint: validated.endpoint },
      create: {
        userId,
        condominiumId,
        endpoint: validated.endpoint,
        p256dh: validated.keys.p256dh,
        auth: validated.keys.auth,
      },
      update: {
        userId,
        condominiumId,
        p256dh: validated.keys.p256dh,
        auth: validated.keys.auth,
        lastSeenAt: new Date(),
      },
    });

    await this.auditService.log({
      condominiumId,
      userId,
      action: 'WHATSAPP_PUSH_SUBSCRIPTION_UPDATED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'PushSubscription',
      entityId: saved.id,
      result: 'SUCCESS',
      description: 'Web Push subscription registered',
      afterState: { pushEnabled: true },
    });

    return saved;
  }

  /**
   * Remove a Web Push subscription. When an `endpoint` is supplied only that
   * device is unsubscribed (the user's other devices keep receiving push); when
   * omitted, every subscription for the current (userId, condominiumId) is
   * removed — a full opt-out from this browser context.
   */
  async removePushSubscription(condominiumId: string, userId: string, endpoint?: string) {
    const where = endpoint
      ? { userId, condominiumId, endpoint }
      : { userId, condominiumId };
    const result = await this.prisma.pushSubscription.deleteMany({ where });

    await this.auditService.log({
      condominiumId,
      userId,
      action: 'WHATSAPP_PUSH_SUBSCRIPTION_REMOVED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'PushSubscription',
      entityId: endpoint ?? 'all',
      result: 'SUCCESS',
      description: `Web Push subscription removed (${result.count})`,
      afterState: { removed: result.count, scope: endpoint ? 'device' : 'all-devices' },
    });

    return { removed: result.count };
  }

  /**
   * Validate a raw Web Push subscription and return the canonical shape.
   * Throws BadRequestException on a malformed payload so an invalid
   * subscription is never persisted.
   */
  private validatePushSubscription(subscription: Record<string, unknown> | undefined): {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  } {
    if (!subscription || typeof subscription !== 'object') {
      throw new BadRequestException('Push subscription payload is required');
    }
    const endpoint = subscription.endpoint;
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
      throw new BadRequestException('Push subscription endpoint is invalid');
    }
    const keys = subscription.keys as Record<string, unknown> | undefined;
    if (
      !keys ||
      typeof keys.p256dh !== 'string' ||
      typeof keys.auth !== 'string' ||
      !keys.p256dh ||
      !keys.auth
    ) {
      throw new BadRequestException('Push subscription keys are missing or invalid');
    }
    const expiration = subscription.expirationTime;
    return {
      endpoint,
      expirationTime: typeof expiration === 'number' ? expiration : null,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    };
  }

  private async ensurePhoneNotInUse(
    condominiumId: string,
    phoneNumber: string,
    userId: string,
  ): Promise<void> {
    const conflict = await this.prisma.whatsAppNotificationPreference.findFirst({
      where: {
        condominiumId,
        personalPhoneNumber: phoneNumber,
        NOT: { userId },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new BadRequestException('Phone number is already registered for another admin');
    }

    const resident = await this.prisma.resident.findFirst({
      where: {
        condominiumId,
        deletedAt: null,
        OR: [{ phone: phoneNumber }, { secondaryPhone: phoneNumber }],
      },
      select: { id: true },
    });
    if (resident) {
      throw new BadRequestException(
        'This phone number belongs to a resident — choose a number not registered in this condominium',
      );
    }
  }

  private async isAdminServiceWindowOpen(personalPhoneNumber: string): Promise<boolean> {
    const since = new Date(Date.now() - SERVICE_WINDOW_MS);
    const recent = await this.prisma.whatsAppMessage.findFirst({
      where: {
        direction: 'INBOUND',
        createdAt: { gte: since },
        conversation: {
          isSystemChannel: true,
          phoneNumber: personalPhoneNumber,
        },
      },
      select: { id: true },
    });
    return Boolean(recent);
  }

  private redactedSnapshot(pref: {
    notifyOnEscalation: boolean;
    notifyChannel: WhatsAppNotifyChannel;
    personalPhoneNumber: string | null;
    personalPhoneVerifiedAt: Date | null;
    reNotifyAfterMinutes: number | null;
  }) {
    return {
      notifyOnEscalation: pref.notifyOnEscalation,
      notifyChannel: pref.notifyChannel,
      personalPhoneConfigured: Boolean(pref.personalPhoneNumber),
      personalPhoneVerified: Boolean(pref.personalPhoneVerifiedAt),
      reNotifyAfterMinutes: pref.reNotifyAfterMinutes,
    };
  }

  ensureNotFound(value: unknown): void {
    if (!value) throw new NotFoundException();
  }
}
