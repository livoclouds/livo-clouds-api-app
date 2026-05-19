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

  async savePushSubscription(
    condominiumId: string,
    userId: string,
    subscription: Record<string, unknown> | undefined,
  ) {
    const preference = await this.getForCurrentUser(condominiumId, userId);
    return this.prisma.whatsAppNotificationPreference.update({
      where: { id: preference.id },
      data: {
        pushSubscriptionJson: (subscription ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  }

  async removePushSubscription(condominiumId: string, userId: string) {
    const preference = await this.getForCurrentUser(condominiumId, userId);
    return this.prisma.whatsAppNotificationPreference.update({
      where: { id: preference.id },
      data: { pushSubscriptionJson: Prisma.JsonNull },
    });
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
