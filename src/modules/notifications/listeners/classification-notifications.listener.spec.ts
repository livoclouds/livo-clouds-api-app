import { NotificationType } from '@prisma/client';
import { ClassificationNotificationsListener } from './classification-notifications.listener';

const SLUG = 'torres-del-sur';
const CONDOMINIUM_ID = 'cond-1';

function makeNotificationsMock() {
  return {
    resolveCondominiumSlug: jest.fn().mockResolvedValue(SLUG),
    dispatchEvent: jest.fn().mockResolvedValue({ recipientCount: 1 }),
    createForEvent: jest.fn().mockResolvedValue({}),
  };
}

describe('ClassificationNotificationsListener', () => {
  it('maps classification.review_needed to CLASSIFICATION_REVIEW with batchId and transactionCount', async () => {
    const notifications = makeNotificationsMock();
    const listener = new ClassificationNotificationsListener(
      notifications as never,
    );

    await listener.onReviewNeeded({
      condominiumId: CONDOMINIUM_ID,
      batchId: 'batch-1',
      transactionCount: 12,
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.CLASSIFICATION_REVIEW,
        condominiumId: CONDOMINIUM_ID,
        title: 'notifications.types.CLASSIFICATION_REVIEW.title',
        message: 'notifications.types.CLASSIFICATION_REVIEW.body',
        data: { batchId: 'batch-1', transactionCount: 12 },
        linkUrl: `/condominiums/${SLUG}/imports/batch-1`,
        actorUserId: 'user-9',
      }),
    );
  });

  it('forwards an undefined actorUserId when the producer did not supply one', async () => {
    const notifications = makeNotificationsMock();
    const listener = new ClassificationNotificationsListener(
      notifications as never,
    );

    await listener.onReviewNeeded({
      condominiumId: CONDOMINIUM_ID,
      batchId: 'batch-1',
      transactionCount: 3,
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: undefined }),
    );
  });

  it('swallows and logs a dispatch failure without rethrowing', async () => {
    const notifications = makeNotificationsMock();
    notifications.dispatchEvent.mockRejectedValue(new Error('db down'));
    const listener = new ClassificationNotificationsListener(
      notifications as never,
    );
    const errorSpy = jest
      .spyOn(
        (listener as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(
      listener.onReviewNeeded({
        condominiumId: CONDOMINIUM_ID,
        batchId: 'batch-1',
        transactionCount: 1,
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
