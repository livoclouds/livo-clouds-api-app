import { Notification, NotificationType } from '@prisma/client';
import {
  NotificationsSseGateway,
  NotificationStreamEvent,
} from './notifications.gateway';

function fakeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    condominiumId: 'cond-1',
    userId: 'user-1',
    type: NotificationType.IMPORT_COMPLETED,
    title: 'title',
    message: 'message',
    isRead: false,
    metadata: null,
    data: null,
    linkUrl: null,
    readAt: null,
    dismissedAt: null,
    aggregateCount: 1,
    aggregateUntil: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Notification;
}

describe('NotificationsSseGateway', () => {
  it('emits a notification event only to the target user streams', () => {
    const gateway = new NotificationsSseGateway();
    const received: NotificationStreamEvent[] = [];
    const otherReceived: NotificationStreamEvent[] = [];
    gateway.register('user-1').subscribe((e) => received.push(e));
    gateway.register('user-2').subscribe((e) => otherReceived.push(e));

    gateway.emitAfterWrite(fakeNotification({ userId: 'user-1' }), false);

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('notification');
    expect(received[0].id).toBe('notif-1');
    expect(received[0].data).toEqual({
      notification: expect.objectContaining({ id: 'notif-1' }),
      isAggregateUpdate: false,
    });
    expect(otherReceived).toHaveLength(0);
  });

  it('delivers to every stream of a multi-tab user', () => {
    const gateway = new NotificationsSseGateway();
    const tabA: NotificationStreamEvent[] = [];
    const tabB: NotificationStreamEvent[] = [];
    gateway.register('user-1').subscribe((e) => tabA.push(e));
    gateway.register('user-1').subscribe((e) => tabB.push(e));
    expect(gateway.getUserStreamCount('user-1')).toBe(2);

    gateway.emitAfterWrite(fakeNotification({ userId: 'user-1' }), true);

    expect(tabA).toHaveLength(1);
    expect(tabB).toHaveLength(1);
    expect(tabA[0].data).toMatchObject({ isAggregateUpdate: true });
  });

  it('removes a stream on unregister and drops the user when none remain', () => {
    const gateway = new NotificationsSseGateway();
    const subjectA = gateway.register('user-1');
    const subjectB = gateway.register('user-1');
    expect(gateway.getConnectionCount()).toBe(1);

    gateway.unregister('user-1', subjectA);
    expect(gateway.getUserStreamCount('user-1')).toBe(1);
    expect(gateway.getConnectionCount()).toBe(1);

    gateway.unregister('user-1', subjectB);
    expect(gateway.getUserStreamCount('user-1')).toBe(0);
    expect(gateway.getConnectionCount()).toBe(0);
  });

  it('stops delivering to an unregistered stream', () => {
    const gateway = new NotificationsSseGateway();
    const received: NotificationStreamEvent[] = [];
    const subject = gateway.register('user-1');
    subject.subscribe((e) => received.push(e));

    gateway.unregister('user-1', subject);
    gateway.emitAfterWrite(fakeNotification({ userId: 'user-1' }), false);

    expect(received).toHaveLength(0);
  });

  it('is a no-op when the target user has no registered streams', () => {
    const gateway = new NotificationsSseGateway();
    expect(() =>
      gateway.emitAfterWrite(fakeNotification({ userId: 'ghost' }), false),
    ).not.toThrow();
  });

  it('is a no-op when the notification has no userId', () => {
    const gateway = new NotificationsSseGateway();
    const received: NotificationStreamEvent[] = [];
    gateway.register('user-1').subscribe((e) => received.push(e));

    gateway.emitAfterWrite(fakeNotification({ userId: null }), false);

    expect(received).toHaveLength(0);
  });
});
