/**
 * Domain events emitted by `CalendarService` for the Notifications module's
 * `CalendarNotificationsListener` (Phase 3). Distinct from
 * `calendar-terrace-changed.event.ts`, which drives terrace reclassification.
 */

export const CALENDAR_EVENT_CREATED_EVENT = 'calendar.event_created';
export const CALENDAR_EVENT_CANCELLED_EVENT = 'calendar.event_cancelled';
export const CALENDAR_BOOKING_CONFIRMED_EVENT = 'calendar.booking_confirmed';

export interface CalendarEventCreatedEventPayload {
  condominiumId: string;
  eventId: string;
  title: string;
  /** ISO-8601 start timestamp. */
  startsAt: string;
  actorUserId: string;
}

export interface CalendarEventCancelledEventPayload {
  condominiumId: string;
  eventId: string;
  title: string;
  actorUserId: string;
}

export interface CalendarBookingConfirmedEventPayload {
  condominiumId: string;
  eventId: string;
  /**
   * No standalone Terrace entity exists — terrace bookings are condominium
   * scoped with a single implicit terrace. `terraceId` stays null until a
   * Terrace model is introduced. See OQ-NT-18.
   */
  terraceId: string | null;
  /** Resident the booking belongs to; drives the RESIDENT owner filter. */
  residentId: string | null;
  /** ISO-8601 start timestamp. */
  startsAt: string;
  actorUserId: string;
}
