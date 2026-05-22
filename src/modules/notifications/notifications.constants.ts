import { NotificationType } from '@prisma/client';

/**
 * Sliding aggregation window. A new event for the same (userId, type,
 * condominiumId) coalesces into an open row while its aggregateUntil is in
 * the future. Hard-coded per the Notifications r1 spec — not tenant- or
 * type-configurable.
 */
export const AGGREGATION_WINDOW_MINUTES = 10;

/**
 * Retention window for notification rows. The daily retention cron hard-deletes
 * rows older than this. Hard-coded per the Notifications r1 spec.
 */
export const NOTIFICATION_RETENTION_DAYS = 90;

/**
 * Notification types surfaced through the per-user preferences contract. The
 * 12 types introduced in Notifications r1, plus `NEGATIVE_BALANCE` and
 * `NEW_INCIDENT` — promoted from the legacy set when the per-user preferences
 * page absorbed the Settings notifications tab. The remaining legacy enum
 * values (`FILE_IMPORTED`, `IMPORT_ERROR`, `NEW_USER`) stay excluded: they have
 * r1 equivalents and no listeners.
 *
 * The preferences service filters incoming keys against this list (and the
 * role matrix), so a type absent here is silently ignored on PATCH.
 */
export const NOTIFICATION_R1_TYPES: NotificationType[] = [
  NotificationType.IMPORT_COMPLETED,
  NotificationType.IMPORT_FAILED,
  NotificationType.IMPORT_WITH_WARNINGS,
  NotificationType.IMPORT_DUPLICATE,
  NotificationType.CLASSIFICATION_REVIEW,
  NotificationType.RECONCILIATION_RULE_MODIFIED,
  NotificationType.CALENDAR_EVENT_CREATED,
  NotificationType.CALENDAR_EVENT_CANCELLED,
  NotificationType.CALENDAR_BOOKING_CONFIRMED,
  NotificationType.NEGATIVE_BALANCE,
  NotificationType.NEW_INCIDENT,
  NotificationType.USER_ADDED,
  NotificationType.PERMISSIONS_CHANGED,
  NotificationType.SESSION_EXPIRING,
];
