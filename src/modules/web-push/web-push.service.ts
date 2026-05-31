import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Web Push — the shared browser/device push channel for every notification.
 *
 * Originally a WhatsApp-escalation supplement (Phase 5), now the delivery
 * mechanism for all notification types: WhatsApp escalations and the general
 * push-on-create dispatch both route through here. Payloads are privacy-safe —
 * they carry an operational title/body only, never message content, phone
 * numbers, media captions, or access tokens.
 *
 * Subscriptions live in the multi-device `PushSubscription` table (one row per
 * browser/device), keyed by a globally unique `endpoint`. A gone subscription
 * (HTTP 404/410) deletes its own row via `sendToSubscription`. The legacy
 * single-row `sendToPreference` path is retained only while the deprecated
 * `WhatsAppNotificationPreference.pushSubscriptionJson` column still exists.
 */
export interface PushNotificationPayload {
  /** Concise OS-notification title. */
  title: string;
  /** Short body — operational subject only, no message content or PII. */
  body: string;
  /** Stable tag so re-notifications replace rather than stack. */
  tag: string;
  /** Same-origin deep-link path for the notification click target. */
  url: string;
}

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
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
    const publicKey = this.configService.get<string>('webPush.publicKey', '');
    const privateKey = this.configService.get<string>('webPush.privateKey', '');
    const subject = this.configService.get<string>(
      'webPush.subject',
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
   * Send a push notification to one `PushSubscription` row (multi-device path).
   *
   * Invalid, revoked, or expired subscriptions (HTTP 404/410) delete their own
   * row so a stale device never breaks future dispatch and other devices for
   * the same user keep working. Any failure is logged without exposing the
   * payload or subscription internals and never throws — dispatch must not
   * crash on a push error.
   */
  async sendToSubscription(
    subscriptionId: string,
    subscriptionJson: unknown,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    return this.deliver(`subId=${subscriptionId}`, subscriptionJson, payload, () =>
      this.deleteSubscriptionRow(subscriptionId),
    );
  }

  /**
   * Legacy single-row send keyed by the preference id. Retained only while the
   * deprecated `pushSubscriptionJson` column exists; new dispatch fans out via
   * {@link sendToSubscription}. A gone subscription clears the legacy field.
   */
  async sendToPreference(
    preferenceId: string,
    subscriptionJson: unknown,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    return this.deliver(`prefId=${preferenceId}`, subscriptionJson, payload, () =>
      this.disableSubscription(preferenceId),
    );
  }

  /**
   * Shared delivery path: narrow the subscription, send, and on a gone status
   * (404/410) run the supplied cleanup. Never throws.
   */
  private async deliver(
    label: string,
    subscriptionJson: unknown,
    payload: PushNotificationPayload,
    onGone: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.ensureVapid()) {
      this.logger.warn('[push] skipped — VAPID keys not configured');
      return false;
    }
    const subscription = this.toSubscription(subscriptionJson);
    if (!subscription) {
      this.logger.warn(`[push] ${label} no usable subscription — skipping`);
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
      this.logger.log(`[push] ${label} delivered (tag=${payload.tag})`);
      return true;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await onGone();
        this.logger.log(`[push] ${label} subscription gone (${statusCode}) — cleared`);
      } else {
        this.logger.error(
          `[push] ${label} delivery failed (status=${statusCode ?? 'n/a'})`,
        );
      }
      return false;
    }
  }

  /** Delete a single gone `PushSubscription` row, keeping the user's other devices. */
  private async deleteSubscriptionRow(subscriptionId: string): Promise<void> {
    try {
      await this.prisma.pushSubscription.deleteMany({ where: { id: subscriptionId } });
    } catch (err) {
      this.logger.error(
        `[push] failed to delete subscription subId=${subscriptionId}: ${(err as Error).message}`,
      );
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
