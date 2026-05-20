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
 * The 12 notification types introduced in Notifications r1. The legacy enum
 * values predating the module are intentionally excluded — they have no
 * listeners and are not surfaced through the r1 preferences contract.
 *
 * Until the Phase 2 role matrix (NOTIFICATION_ROLE_ACCESS) lands, the
 * preferences endpoints expose every type in this list unfiltered.
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
  NotificationType.USER_ADDED,
  NotificationType.PERMISSIONS_CHANGED,
  NotificationType.SESSION_EXPIRING,
];
