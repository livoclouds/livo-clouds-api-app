// Calendar maintenance windows (CAL-043). Kept as plain constants. The
// tenant-configurable PENDING hold window for *future* bookings (CAL-064) is NOT a
// constant — it lives per-tenant on `CondominiumSettings.pendingHoldWindowHours`
// and the cron reads it per row; the constant below only governs the always-on
// past-date expiry branch.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Grace period after a terrace booking's start date before an unconfirmed
 * (PENDING) booking is auto-expired. A booking whose event date has already
 * passed and was never confirmed/paid is releasing nothing useful — it only
 * keeps holding the slot. 0 = expire as soon as the event date is in the past.
 *
 * This governs only the past-date branch. The release of a *future* unpaid slot is
 * tenant-driven via `CondominiumSettings.pendingHoldWindowHours` (CAL-064), read by
 * the maintenance cron — not by this constant.
 */
export const STALE_PENDING_GRACE_MS = 0;

/**
 * Retention window for soft-deleted (cancelled-and-removed) calendar events
 * before the maintenance cron hard-deletes them. 90 days mirrors the imports
 * abandoned-upload retention philosophy: keep a recovery/audit window, then
 * reclaim storage.
 */
export const SOFT_DELETE_RETENTION_MS = 90 * DAY_MS;

/**
 * Cross-replica leadership lock for the daily maintenance sweep (CAL-059). A
 * single global Postgres advisory lock: per scheduled tick only one replica
 * acquires it and runs the sweep; the rest step aside. The two keys are hashed
 * in SQL (`hashtext`) into the `pg_try_advisory_xact_lock(int4, int4)` pair.
 */
export const CALENDAR_MAINTENANCE_LOCK_NAMESPACE = 'calendar-maintenance';
export const CALENDAR_MAINTENANCE_LOCK_KEY = 'sweep';

/**
 * The lock is held for the sweep's full duration (idle-in-transaction while the
 * sweep writes on other pooled connections), so the interactive-transaction
 * timeout must exceed a worst-case multi-tenant sweep — well above Prisma's 5s
 * default. 10 min is generous headroom for a nightly job.
 */
export const CALENDAR_MAINTENANCE_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
