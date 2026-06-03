import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import {
  CLASSIFICATION_REVIEW_NEEDED_EVENT,
  type ClassificationReviewNeededEventPayload,
} from '../../classification/events/classification-notification-events';
import { NotificationsService } from '../notifications.service';
import { copyKeys, importBatchLink } from './notification-links';

/**
 * Translates the `ClassificationService` review-needed domain event into a
 * CLASSIFICATION_REVIEW notification. The review queue lives on the import
 * batch screen, so the deep link points there.
 */
@Injectable()
export class ClassificationNotificationsListener {
  private readonly logger = new Logger(
    ClassificationNotificationsListener.name,
  );

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(CLASSIFICATION_REVIEW_NEEDED_EVENT)
  async onReviewNeeded(
    payload: ClassificationReviewNeededEventPayload,
  ): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.CLASSIFICATION_REVIEW,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.CLASSIFICATION_REVIEW),
        data: {
          batchId: payload.batchId,
          transactionCount: payload.transactionCount,
        },
        linkUrl: slug ? importBatchLink(payload.batchId) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logger.error(
        `${CLASSIFICATION_REVIEW_NEEDED_EVENT} listener failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
