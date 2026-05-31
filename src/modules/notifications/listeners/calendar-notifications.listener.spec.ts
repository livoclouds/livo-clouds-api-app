import { NotificationType } from '@prisma/client';
import { CalendarNotificationsListener } from './calendar-notifications.listener';

const SLUG = 'torres-del-sur';
const CONDOMINIUM_ID = 'cond-1';
const STARTS_AT = '2026-06-15T18:00:00.000Z';

function makeNotificationsMock() {
  return {
    resolveCondominiumSlug: jest.fn().mockResolvedValue(SLUG),
    dispatchEvent: jest.fn().mockResolvedValue({ recipientCount: 1 }),
    createForEvent: jest.fn().mockResolvedValue({}),
  };
}

describe('CalendarNotificationsListener', () => {
  it('maps calendar.event_created to CALENDAR_EVENT_CREATED', async () => {
    const notifications = makeNotificationsMock();
    const listener = new CalendarNotificationsListener(notifications as never);

    await listener.onEventCreated({
      condominiumId: CONDOMINIUM_ID,
      eventId: 'event-1',
      title: 'Council meeting',
      startsAt: STARTS_AT,
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.CALENDAR_EVENT_CREATED,
        condominiumId: CONDOMINIUM_ID,
        data: { eventId: 'event-1', title: 'Council meeting', startsAt: STARTS_AT },
        linkUrl: `/condominiums/${SLUG}/calendar/event-1`,
        actorUserId: 'user-9',
      }),
    );
  });

  it('maps calendar.event_cancelled to CALENDAR_EVENT_CANCELLED linking to the calendar index', async () => {
    const notifications = makeNotificationsMock();
    const listener = new CalendarNotificationsListener(notifications as never);

    await listener.onEventCancelled({
      condominiumId: CONDOMINIUM_ID,
      eventId: 'event-2',
      title: 'Council meeting',
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.CALENDAR_EVENT_CANCELLED,
        data: { eventId: 'event-2', title: 'Council meeting' },
        linkUrl: `/condominiums/${SLUG}/calendar`,
        actorUserId: 'user-9',
      }),
    );
  });

  it('maps calendar.booking_confirmed to CALENDAR_BOOKING_CONFIRMED including residentId for the RESIDENT filter', async () => {
    const notifications = makeNotificationsMock();
    const listener = new CalendarNotificationsListener(notifications as never);

    await listener.onBookingConfirmed({
      condominiumId: CONDOMINIUM_ID,
      eventId: 'event-3',
      terraceId: null,
      residentId: 'res-7',
      startsAt: STARTS_AT,
      actorUserId: 'user-9',
    });

    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.CALENDAR_BOOKING_CONFIRMED,
        data: {
          eventId: 'event-3',
          terraceId: null,
          residentId: 'res-7',
          startsAt: STARTS_AT,
        },
        linkUrl: `/condominiums/${SLUG}/calendar/event-3`,
        actorUserId: 'user-9',
      }),
    );
    // residentId is the field resolveRecipientsForType uses to filter RESIDENT
    // recipients to the booking's owner.
    const call = notifications.dispatchEvent.mock.calls[0][0] as {
      data: { residentId: unknown };
    };
    expect(call.data.residentId).toBe('res-7');
  });

  it('swallows and logs a dispatch failure without rethrowing', async () => {
    const notifications = makeNotificationsMock();
    notifications.dispatchEvent.mockRejectedValue(new Error('db down'));
    const listener = new CalendarNotificationsListener(notifications as never);
    const errorSpy = jest
      .spyOn(
        (listener as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(
      listener.onEventCreated({
        condominiumId: CONDOMINIUM_ID,
        eventId: 'event-1',
        title: 'X',
        startsAt: STARTS_AT,
        actorUserId: 'user-9',
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
