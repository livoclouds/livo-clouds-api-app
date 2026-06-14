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
  // in afterState. Optional: when absent, the reclassify service falls back to the
  // triggering event's creator (CAL-074) so the run stays audited; only an
  // unresolvable event leaves it un-audited (never an FK failure).
  actorUserId?: string | null;
}
