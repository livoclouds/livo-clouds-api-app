import { NotificationType } from '@prisma/client';
import { ReconciliationNotificationsListener } from './reconciliation-notifications.listener';

const SLUG = 'torres-del-sur';
const CONDOMINIUM_ID = 'cond-1';

function makeNotificationsMock() {
  return {
    resolveCondominiumSlug: jest.fn().mockResolvedValue(SLUG),
    dispatchEvent: jest.fn().mockResolvedValue({ recipientCount: 1 }),
    createForEvent: jest.fn().mockResolvedValue({}),
  };
}

describe('ReconciliationNotificationsListener', () => {
  it.each(['created', 'updated', 'deactivated'] as const)(
    'maps reconciliation.rule_modified (%s) to RECONCILIATION_RULE_MODIFIED',
    async (action) => {
      const notifications = makeNotificationsMock();
      const listener = new ReconciliationNotificationsListener(
        notifications as never,
      );

      await listener.onRuleModified({
        condominiumId: CONDOMINIUM_ID,
        ruleId: 'rule-1',
        ruleName: 'Maintenance keywords',
        action,
        actorUserId: 'user-9',
      });

      expect(notifications.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.RECONCILIATION_RULE_MODIFIED,
          condominiumId: CONDOMINIUM_ID,
          title: 'notifications.types.RECONCILIATION_RULE_MODIFIED.title',
          message: 'notifications.types.RECONCILIATION_RULE_MODIFIED.body',
          data: { ruleId: 'rule-1', ruleName: 'Maintenance keywords', action },
          linkUrl: `/condominiums/${SLUG}/settings/reconciliation-rules`,
          actorUserId: 'user-9',
        }),
      );
    },
  );

  it('swallows and logs a dispatch failure without rethrowing', async () => {
    const notifications = makeNotificationsMock();
    notifications.dispatchEvent.mockRejectedValue(new Error('db down'));
    const listener = new ReconciliationNotificationsListener(
      notifications as never,
    );
    const errorSpy = jest
      .spyOn(
        (listener as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(
      listener.onRuleModified({
        condominiumId: CONDOMINIUM_ID,
        ruleId: 'rule-1',
        ruleName: 'X',
        action: 'created',
        actorUserId: 'user-9',
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
