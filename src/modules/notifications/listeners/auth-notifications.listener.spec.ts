import { NotificationType } from '@prisma/client';
import { AuthNotificationsListener } from './auth-notifications.listener';

function makeNotificationsMock() {
  return {
    resolveCondominiumSlug: jest.fn().mockResolvedValue('torres-del-sur'),
    dispatchEvent: jest.fn().mockResolvedValue({ recipientCount: 1 }),
    createForEvent: jest.fn().mockResolvedValue({}),
  };
}

describe('AuthNotificationsListener', () => {
  it('maps session.expiring_soon to a single-user SESSION_EXPIRING notification (no fan-out)', async () => {
    const notifications = makeNotificationsMock();
    const listener = new AuthNotificationsListener(notifications as never);

    await listener.onSessionExpiring({
      userId: 'user-7',
      condominiumId: 'cond-1',
      minutesRemaining: 5,
    });

    // SESSION_EXPIRING targets the user themselves — createForEvent, not the
    // fan-out dispatchEvent.
    expect(notifications.dispatchEvent).not.toHaveBeenCalled();
    expect(notifications.createForEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-7',
        condominiumId: 'cond-1',
        type: NotificationType.SESSION_EXPIRING,
        title: 'notifications.types.SESSION_EXPIRING.title',
        message: 'notifications.types.SESSION_EXPIRING.body',
        data: { minutesRemaining: 5 },
        linkUrl: null,
      }),
    );
  });

  it('swallows and logs a createForEvent failure without rethrowing', async () => {
    const notifications = makeNotificationsMock();
    notifications.createForEvent.mockRejectedValue(new Error('db down'));
    const listener = new AuthNotificationsListener(notifications as never);
    const errorSpy = jest
      .spyOn(
        (listener as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(
      listener.onSessionExpiring({
        userId: 'user-7',
        condominiumId: null,
        minutesRemaining: 2,
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
