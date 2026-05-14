export const CALENDAR_TERRACE_CHANGED = 'calendar.terrace.changed';

export interface CalendarTerraceChangedPayload {
  condominiumId: string;
  triggeringEventId: string;
  action: 'create' | 'update' | 'delete';
  windowStart: Date;
  windowEnd: Date;
  reason: string;
}
