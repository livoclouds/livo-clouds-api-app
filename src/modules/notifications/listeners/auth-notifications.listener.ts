import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import {
  SESSION_EXPIRING_EVENT,
  type SessionExpiringEventPayload,
} from '../../auth/events/auth-notification-events';
import { NotificationsService } from '../notifications.service';
import { copyKeys } from './notification-links';

/**
 * Translates the `session.expiring_soon` domain event into a SESSION_EXPIRING
 * notification.
 *
 * Unlike the other listeners this does NOT fan out: a session warning targets
 * exactly the user whose session is expiring, so it calls the per-user
 * `createForEvent` directly with the payload's `userId` — no role-matrix
 * resolution, no actor exclusion (the recipient IS the subject).
 *
 * No producer emits this event in Phase 3 (see OQ-NT-15): the listener and
 * contract are in place so a future client-driven emitter works without
 * further wiring.
 */
@Injectable()
export class AuthNotificationsListener {
  private readonly logger = new Logger(AuthNotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(SESSION_EXPIRING_EVENT)
  async onSessionExpiring(
    payload: SessionExpiringEventPayload,
  ): Promise<void> {
    try {
      await this.notifications.createForEvent({
        userId: payload.userId,
        condominiumId: payload.condominiumId,
        type: NotificationType.SESSION_EXPIRING,
        ...copyKeys(NotificationType.SESSION_EXPIRING),
        data: { minutesRemaining: payload.minutesRemaining },
        linkUrl: null,
      });
    } catch (err) {
      this.logger.error(
        `${SESSION_EXPIRING_EVENT} listener failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
