import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import {
  USER_ADDED_EVENT,
  USER_PERMISSIONS_CHANGED_EVENT,
  type UserAddedEventPayload,
  type UserPermissionsChangedEventPayload,
} from '../../users/events/user-notification-events';
import { NotificationsService } from '../notifications.service';
import { copyKeys, usersLink } from './notification-links';

/**
 * Translates `UsersService` domain events into notifications. Both events
 * deep-link to the user-management screen.
 */
@Injectable()
export class UsersNotificationsListener {
  private readonly logger = new Logger(UsersNotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(USER_ADDED_EVENT)
  async onUserAdded(payload: UserAddedEventPayload): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.USER_ADDED,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.USER_ADDED),
        data: {
          userId: payload.userId,
          email: payload.email,
          role: payload.role,
        },
        linkUrl: slug ? usersLink(slug) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(USER_ADDED_EVENT, err);
    }
  }

  @OnEvent(USER_PERMISSIONS_CHANGED_EVENT)
  async onPermissionsChanged(
    payload: UserPermissionsChangedEventPayload,
  ): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.PERMISSIONS_CHANGED,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.PERMISSIONS_CHANGED),
        data: {
          userId: payload.userId,
          beforeRole: payload.beforeRole,
          afterRole: payload.afterRole,
        },
        linkUrl: slug ? usersLink(slug) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(USER_PERMISSIONS_CHANGED_EVENT, err);
    }
  }

  private logFailure(event: string, err: unknown): void {
    this.logger.error(
      `${event} listener failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      err instanceof Error ? err.stack : undefined,
    );
  }
}
