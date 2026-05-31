import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import {
  CALENDAR_BOOKING_CONFIRMED_EVENT,
  CALENDAR_EVENT_CANCELLED_EVENT,
  CALENDAR_EVENT_CREATED_EVENT,
  type CalendarBookingConfirmedEventPayload,
  type CalendarEventCancelledEventPayload,
  type CalendarEventCreatedEventPayload,
} from '../../calendar/events/calendar-notification-events';
import { NotificationsService } from '../notifications.service';
import { calendarEventLink, calendarLink, copyKeys } from './notification-links';

/**
 * Translates `CalendarService` domain events into notifications. The booking
 * confirmation carries `residentId`, which `dispatchEvent` forwards to the
 * RESIDENT owner filter so only the booking's resident-user receives it.
 */
@Injectable()
export class CalendarNotificationsListener {
  private readonly logger = new Logger(CalendarNotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(CALENDAR_EVENT_CREATED_EVENT)
  async onEventCreated(
    payload: CalendarEventCreatedEventPayload,
  ): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.CALENDAR_EVENT_CREATED,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.CALENDAR_EVENT_CREATED),
        data: {
          eventId: payload.eventId,
          title: payload.title,
          startsAt: payload.startsAt,
        },
        linkUrl: slug ? calendarEventLink(slug, payload.eventId) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(CALENDAR_EVENT_CREATED_EVENT, err);
    }
  }

  @OnEvent(CALENDAR_EVENT_CANCELLED_EVENT)
  async onEventCancelled(
    payload: CalendarEventCancelledEventPayload,
  ): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.CALENDAR_EVENT_CANCELLED,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.CALENDAR_EVENT_CANCELLED),
        data: {
          eventId: payload.eventId,
          title: payload.title,
        },
        // The event row is soft-deleted, so link to the calendar index.
        linkUrl: slug ? calendarLink(slug) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(CALENDAR_EVENT_CANCELLED_EVENT, err);
    }
  }

  @OnEvent(CALENDAR_BOOKING_CONFIRMED_EVENT)
  async onBookingConfirmed(
    payload: CalendarBookingConfirmedEventPayload,
  ): Promise<void> {
    try {
      const slug = await this.notifications.resolveCondominiumSlug(
        payload.condominiumId,
      );
      await this.notifications.dispatchEvent({
        type: NotificationType.CALENDAR_BOOKING_CONFIRMED,
        condominiumId: payload.condominiumId,
        ...copyKeys(NotificationType.CALENDAR_BOOKING_CONFIRMED),
        data: {
          eventId: payload.eventId,
          terraceId: payload.terraceId,
          residentId: payload.residentId,
          startsAt: payload.startsAt,
        },
        linkUrl: slug ? calendarEventLink(slug, payload.eventId) : null,
        actorUserId: payload.actorUserId,
      });
    } catch (err) {
      this.logFailure(CALENDAR_BOOKING_CONFIRMED_EVENT, err);
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
