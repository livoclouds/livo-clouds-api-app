import { NotificationType } from '@prisma/client';
import { ImportsNotificationsListener } from './imports-notifications.listener';

const SLUG = 'torres-del-sur';
const CONDOMINIUM_ID = 'cond-1';

interface NotificationsMock {
  resolveCondominiumSlug: jest.Mock;
  dispatchEvent: jest.Mock;
  createForEvent: jest.Mock;
}

function makeNotificationsMock(): NotificationsMock {
  return {
    resolveCondominiumSlug: jest.fn().mockResolvedValue(SLUG),
    dispatchEvent: jest.fn().mockResolvedValue({ recipientCount: 1 }),
    createForEvent: jest.fn().mockResolvedValue({}),
  };
}

function makeListener(
  notifications: NotificationsMock,
): ImportsNotificationsListener {
  return new ImportsNotificationsListener(notifications as never);
}

describe('ImportsNotificationsListener', () => {
  it('maps import.completed to IMPORT_COMPLETED with the documented data shape', async () => {
    const notifications = makeNotificationsMock();
    const listener = makeListener(notifications);

    await listener.onImportCompleted({
      condominiumId: CONDOMINIUM_ID,
      batchId: 'batch-1',
      rowCount: 142,
      currency: 'MXN',
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.IMPORT_COMPLETED,
        condominiumId: CONDOMINIUM_ID,
        title: 'notifications.types.IMPORT_COMPLETED.title',
        message: 'notifications.types.IMPORT_COMPLETED.body',
        data: { batchId: 'batch-1', rowCount: 142, currency: 'MXN' },
        linkUrl: '/imports/batch-1',
        actorUserId: 'user-9',
        includeActor: true,
      }),
    );
  });

  it('maps import.failed to IMPORT_FAILED with batchId, stage and errorCode', async () => {
    const notifications = makeNotificationsMock();
    const listener = makeListener(notifications);

    await listener.onImportFailed({
      condominiumId: CONDOMINIUM_ID,
      batchId: 'batch-2',
      stage: 'VALIDATE',
      errorCode: 'INVALID_ROWS_EXCEEDED',
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.IMPORT_FAILED,
        data: {
          batchId: 'batch-2',
          stage: 'VALIDATE',
          errorCode: 'INVALID_ROWS_EXCEEDED',
        },
        linkUrl: '/imports/batch-2',
        actorUserId: 'user-9',
        includeActor: true,
      }),
    );
  });

  it('maps import.warning to IMPORT_WITH_WARNINGS with warningCount', async () => {
    const notifications = makeNotificationsMock();
    const listener = makeListener(notifications);

    await listener.onImportWarning({
      condominiumId: CONDOMINIUM_ID,
      batchId: 'batch-3',
      warningCount: 7,
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.IMPORT_WITH_WARNINGS,
        data: { batchId: 'batch-3', warningCount: 7 },
        actorUserId: 'user-9',
        includeActor: true,
      }),
    );
  });

  it('maps import.duplicate to IMPORT_DUPLICATE with originalBatchId and attemptedFileName', async () => {
    const notifications = makeNotificationsMock();
    const listener = makeListener(notifications);

    await listener.onImportDuplicate({
      condominiumId: CONDOMINIUM_ID,
      originalBatchId: 'batch-orig',
      attemptedFileName: 'january.xlsx',
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.IMPORT_DUPLICATE,
        data: {
          originalBatchId: 'batch-orig',
          attemptedFileName: 'january.xlsx',
        },
        linkUrl: '/imports/batch-orig',
        actorUserId: 'user-9',
        includeActor: true,
      }),
    );
  });

  it('stores a null linkUrl when the condominium slug cannot be resolved', async () => {
    const notifications = makeNotificationsMock();
    notifications.resolveCondominiumSlug.mockResolvedValue(null);
    const listener = makeListener(notifications);

    await listener.onImportCompleted({
      condominiumId: CONDOMINIUM_ID,
      batchId: 'batch-1',
      rowCount: 1,
      currency: 'MXN',
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ linkUrl: null }),
    );
  });

  it('swallows and logs a dispatch failure without rethrowing', async () => {
    const notifications = makeNotificationsMock();
    notifications.dispatchEvent.mockRejectedValue(new Error('db down'));
    const listener = makeListener(notifications);
    const errorSpy = jest
      .spyOn(
        (listener as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(
      listener.onImportCompleted({
        condominiumId: CONDOMINIUM_ID,
        batchId: 'batch-1',
        rowCount: 1,
        currency: 'MXN',
        actorUserId: 'user-9',
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
