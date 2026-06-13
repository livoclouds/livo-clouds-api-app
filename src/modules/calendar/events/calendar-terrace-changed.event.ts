export const CALENDAR_TERRACE_CHANGED = 'calendar.terrace.changed';

export interface CalendarTerraceChangedPayload {
  condominiumId: string;
  triggeringEventId: string;
  action: 'create' | 'update' | 'delete';
  windowStart: Date;
  windowEnd: Date;
  reason: string;
  // CAL-039: the user whose calendar write triggered this re-match. The engine
  // reclassify runs outside any HTTP request, so audit_logs.userId (a required
  // FK to users) is attributed to this actor with `triggeredBy:'system-reclassify'`
  // in afterState. Optional so non-user-driven emitters degrade to an un-audited
  // run rather than an FK failure.
  actorUserId?: string | null;
}
