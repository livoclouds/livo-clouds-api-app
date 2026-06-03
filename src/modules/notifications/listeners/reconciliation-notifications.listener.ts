import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import {
  RECONCILIATION_RULE_MODIFIED_EVENT,
  type ReconciliationRuleModifiedEventPayload,
} from '../../reconciliation-rules/events/reconciliation-notification-events';
import { NotificationsService } from '../notifications.service';
import { copyKeys, reconciliationRulesLink } from './notification-links';

/**
 * Translates `ReconciliationRulesService` change events into a
 * RECONCILIATION_RULE_MODIFIED notification. The `action` discriminator
 * (`created` | `updated` | `deactivated`) travels through in the `data` blob.
 */
@Injectable()
export class ReconciliationNotificationsListener {
  private readonly logger = new Logger(
    ReconciliationNotificationsListener.name,
  );

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(RECONCILIATION_RULE_MODIFIED_EVENT)
  async onRuleModified(
    payload: ReconciliationRuleModifiedEventPayload,
  ): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.RECONCILIATION_RULE_MODIFIED,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.RECONCILIATION_RULE_MODIFIED),
        data: {
          ruleId: payload.ruleId,
          ruleName: payload.ruleName,
          action: payload.action,
        },
        linkUrl: slug ? reconciliationRulesLink() : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logger.error(
        `${RECONCILIATION_RULE_MODIFIED_EVENT} listener failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
