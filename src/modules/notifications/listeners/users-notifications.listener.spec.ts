import { NotificationType } from '@prisma/client';
import { UsersNotificationsListener } from './users-notifications.listener';

const SLUG = 'torres-del-sur';
const CONDOMINIUM_ID = 'cond-1';

function makeNotificationsMock() {
  return {
    resolveCondominiumSlug: jest.fn().mockResolvedValue(SLUG),
    dispatchEvent: jest.fn().mockResolvedValue({ recipientCount: 1 }),
    createForEvent: jest.fn().mockResolvedValue({}),
  };
}

describe('UsersNotificationsListener', () => {
  it('maps user.added to USER_ADDED with userId, email and role', async () => {
    const notifications = makeNotificationsMock();
    const listener = new UsersNotificationsListener(notifications as never);

    await listener.onUserAdded({
      condominiumId: CONDOMINIUM_ID,
      userId: 'user-new',
      email: 'new@example.com',
      role: 'TENANT_ADMIN',
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.USER_ADDED,
        condominiumId: CONDOMINIUM_ID,
        title: 'notifications.types.USER_ADDED.title',
        message: 'notifications.types.USER_ADDED.body',
        data: {
          userId: 'user-new',
          email: 'new@example.com',
          role: 'TENANT_ADMIN',
        },
        linkUrl: `/condominiums/${SLUG}/settings/users`,
        actorUserId: 'user-9',
      }),
    );
  });

  it('maps user.permissions_changed to PERMISSIONS_CHANGED with beforeRole and afterRole', async () => {
    const notifications = makeNotificationsMock();
    const listener = new UsersNotificationsListener(notifications as never);

    await listener.onPermissionsChanged({
      condominiumId: CONDOMINIUM_ID,
      userId: 'user-target',
      beforeRole: 'READ_ONLY',
      afterRole: 'TENANT_ADMIN',
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.PERMISSIONS_CHANGED,
        data: {
          userId: 'user-target',
          beforeRole: 'READ_ONLY',
          afterRole: 'TENANT_ADMIN',
        },
        linkUrl: `/condominiums/${SLUG}/settings/users`,
        actorUserId: 'user-9',
      }),
    );
  });

  it('swallows and logs a dispatch failure without rethrowing', async () => {
    const notifications = makeNotificationsMock();
    notifications.dispatchEvent.mockRejectedValue(new Error('db down'));
    const listener = new UsersNotificationsListener(notifications as never);
    const errorSpy = jest
      .spyOn(
        (listener as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(
      listener.onUserAdded({
        condominiumId: CONDOMINIUM_ID,
        userId: 'user-new',
        email: 'new@example.com',
        role: 'GUARD',
        actorUserId: 'user-9',
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
