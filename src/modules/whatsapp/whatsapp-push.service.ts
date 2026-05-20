import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Web Push (Phase 5) — supplementary channel for admin escalation alerts.
 *
 * WhatsApp-to-admin remains the primary channel; Push is opt-in and only
 * dispatched when an admin has stored a valid subscription and selected the
 * PUSH or BOTH channel. Payloads are privacy-safe: they never carry message
 * content, phone numbers, media captions, or access tokens.
 */
export interface PushNotificationPayload {
  /** Concise OS-notification title. */
  title: string;
  /** Short body — operational subject only, no message content or PII. */
  body: string;
  /** Stable tag so re-notifications replace rather than stack. */
  tag: string;
  /** Same-origin deep-link path to the conversation. */
  url: string;
}

@Injectable()
export class WhatsAppPushService {
  private readonly logger = new Logger(WhatsAppPushService.name);
  private vapidConfigured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /** True when VAPID keys are present and Push dispatch is possible. */
  isConfigured(): boolean {
    return this.ensureVapid();
  }

  private ensureVapid(): boolean {
    if (this.vapidConfigured) return true;
    const publicKey = this.configService.get<string>('whatsapp.vapidPublicKey', '');
    const privateKey = this.configService.get<string>('whatsapp.vapidPrivateKey', '');
    const subject = this.configService.get<string>(
      'whatsapp.vapidSubject',
      'mailto:contact@livoclouds.com',
    );
    if (!publicKey || !privateKey) return false;
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
      return true;
    } catch (err) {
      this.logger.error(`[push] VAPID configuration failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Send a push notification to one admin's stored subscription.
   *
   * Invalid, revoked, or expired subscriptions (HTTP 404/410) are cleared from
   * the preference so a stale subscription never breaks future dispatch. Any
   * failure is logged without exposing the payload or subscription internals
   * and never throws — escalation dispatch must not crash on a push error.
   */
  async sendToPreference(
    preferenceId: string,
    subscriptionJson: unknown,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    if (!this.ensureVapid()) {
      this.logger.warn('[push] skipped — VAPID keys not configured');
      return false;
    }
    const subscription = this.toSubscription(subscriptionJson);
    if (!subscription) {
      this.logger.warn(`[push] prefId=${preferenceId} no usable subscription — skipping`);
      return false;
    }
    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      tag: payload.tag,
      url: payload.url,
    });
    try {
      await webpush.sendNotification(subscription, body, { TTL: 600 });
      this.logger.log(`[push] prefId=${preferenceId} delivered (tag=${payload.tag})`);
      return true;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await this.disableSubscription(preferenceId);
        this.logger.log(
          `[push] prefId=${preferenceId} subscription gone (${statusCode}) — cleared`,
        );
      } else {
        this.logger.error(
          `[push] prefId=${preferenceId} delivery failed (status=${statusCode ?? 'n/a'})`,
        );
      }
      return false;
    }
  }

  private async disableSubscription(preferenceId: string): Promise<void> {
    try {
      await this.prisma.whatsAppNotificationPreference.update({
        where: { id: preferenceId },
        data: { pushSubscriptionJson: Prisma.JsonNull },
      });
    } catch (err) {
      this.logger.error(
        `[push] failed to clear subscription prefId=${preferenceId}: ${(err as Error).message}`,
      );
    }
  }

  /** Narrow an untyped JSON value into a Web Push subscription, or null. */
  private toSubscription(json: unknown): webpush.PushSubscription | null {
    if (!json || typeof json !== 'object') return null;
    const obj = json as Record<string, unknown>;
    const keys = obj.keys as Record<string, unknown> | undefined;
    if (typeof obj.endpoint !== 'string') return null;
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      return null;
    }
    return {
      endpoint: obj.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    };
  }
}
