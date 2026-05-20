import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import {
  IMPORT_COMPLETED_EVENT,
  IMPORT_DUPLICATE_EVENT,
  IMPORT_FAILED_EVENT,
  IMPORT_WARNING_EVENT,
  type ImportCompletedEventPayload,
  type ImportDuplicateEventPayload,
  type ImportFailedEventPayload,
  type ImportWarningEventPayload,
} from '../../imports/events/import-notification-events';
import { NotificationsService } from '../notifications.service';
import { copyKeys, importBatchLink } from './notification-links';

/**
 * Translates `ImportsService` domain events into notifications. Thin by
 * design: it maps a domain payload to a notification type, `data` blob and
 * `linkUrl`, then hands off to `NotificationsService.dispatchEvent` which
 * owns recipient resolution, aggregation and SSE fan-out. Every handler
 * swallows its own errors — notifications are best-effort.
 */
@Injectable()
export class ImportsNotificationsListener {
  private readonly logger = new Logger(ImportsNotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(IMPORT_COMPLETED_EVENT)
  async onImportCompleted(
    payload: ImportCompletedEventPayload,
  ): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.IMPORT_COMPLETED,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.IMPORT_COMPLETED),
        data: {
          batchId: payload.batchId,
          rowCount: payload.rowCount,
          currency: payload.currency,
        },
        linkUrl: slug ? importBatchLink(slug, payload.batchId) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(IMPORT_COMPLETED_EVENT, err);
    }
  }

  @OnEvent(IMPORT_FAILED_EVENT)
  async onImportFailed(payload: ImportFailedEventPayload): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.IMPORT_FAILED,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.IMPORT_FAILED),
        data: {
          batchId: payload.batchId,
          stage: payload.stage,
          errorCode: payload.errorCode,
        },
        linkUrl: slug ? importBatchLink(slug, payload.batchId) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(IMPORT_FAILED_EVENT, err);
    }
  }

  @OnEvent(IMPORT_WARNING_EVENT)
  async onImportWarning(payload: ImportWarningEventPayload): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.IMPORT_WITH_WARNINGS,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.IMPORT_WITH_WARNINGS),
        data: {
          batchId: payload.batchId,
          warningCount: payload.warningCount,
        },
        linkUrl: slug ? importBatchLink(slug, payload.batchId) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(IMPORT_WARNING_EVENT, err);
    }
  }

  @OnEvent(IMPORT_DUPLICATE_EVENT)
  async onImportDuplicate(
    payload: ImportDuplicateEventPayload,
  ): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.IMPORT_DUPLICATE,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.IMPORT_DUPLICATE),
        data: {
          originalBatchId: payload.originalBatchId,
          attemptedFileName: payload.attemptedFileName,
        },
        linkUrl: slug ? importBatchLink(slug, payload.originalBatchId) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(IMPORT_DUPLICATE_EVENT, err);
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
