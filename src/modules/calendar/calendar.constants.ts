// Calendar maintenance windows (CAL-043). Kept as plain constants — the
// tenant-configurable PENDING hold window for *future* bookings is an explicit
// follow-up (see audit backlog), so the cron only acts on unambiguous cases.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Grace period after a terrace booking's start date before an unconfirmed
 * (PENDING) booking is auto-expired. A booking whose event date has already
 * passed and was never confirmed/paid is releasing nothing useful — it only
 * keeps holding the slot. 0 = expire as soon as the event date is in the past.
 */
export const STALE_PENDING_GRACE_MS = 0;

/**
 * Retention window for soft-deleted (cancelled-and-removed) calendar events
 * before the maintenance cron hard-deletes them. 90 days mirrors the imports
 * abandoned-upload retention philosophy: keep a recovery/audit window, then
 * reclaim storage.
 */
export const SOFT_DELETE_RETENTION_MS = 90 * DAY_MS;
