import { NotificationType, UserRole } from '@prisma/client';

/**
 * Legacy NotificationType values that predate the Notifications module. They
 * have no listeners and are excluded from the r1 role matrix. Kept as an
 * explicit union so the exhaustiveness check below targets exactly the 12 r1
 * types.
 */
type LegacyNotificationType =
  | 'NEGATIVE_BALANCE'
  | 'FILE_IMPORTED'
  | 'IMPORT_ERROR'
  | 'NEW_USER'
  | 'NEW_INCIDENT';

/**
 * The 12 notification types introduced in Notifications r1. Derived from the
 * Prisma enum by subtraction so it stays in sync automatically: adding a new
 * r1 value to NotificationType widens this union and breaks the `satisfies`
 * check on NOTIFICATION_ROLE_ACCESS until the matrix gets an entry for it.
 */
export type R1NotificationType = Exclude<
  NotificationType,
  LegacyNotificationType
>;

/**
 * Single source of truth for which roles may receive each r1 notification
 * type. Recipient resolution (NotificationsService.resolveRecipientsForType)
 * reads this matrix; controllers and future listeners must not re-derive role
 * filtering on their own.
 *
 * The `satisfies Record<R1NotificationType, UserRole[]>` clause makes the
 * matrix exhaustive at compile time — a missing or unknown key fails the
 * build. The literal type is preserved for callers that index it directly.
 */
export const NOTIFICATION_ROLE_ACCESS = {
  // Imports
  IMPORT_COMPLETED: [
    UserRole.ROOT,
    UserRole.TENANT_ADMIN,
    UserRole.READ_ONLY,
  ],
  IMPORT_FAILED: [UserRole.ROOT, UserRole.TENANT_ADMIN],
  IMPORT_WITH_WARNINGS: [UserRole.ROOT, UserRole.TENANT_ADMIN],
  IMPORT_DUPLICATE: [UserRole.ROOT, UserRole.TENANT_ADMIN],

  // Classification
  CLASSIFICATION_REVIEW: [UserRole.ROOT, UserRole.TENANT_ADMIN],

  // Reconciliation
  RECONCILIATION_RULE_MODIFIED: [UserRole.ROOT, UserRole.TENANT_ADMIN],

  // Calendar
  CALENDAR_EVENT_CREATED: [
    UserRole.ROOT,
    UserRole.TENANT_ADMIN,
    UserRole.READ_ONLY,
  ],
  CALENDAR_EVENT_CANCELLED: [
    UserRole.ROOT,
    UserRole.TENANT_ADMIN,
    UserRole.READ_ONLY,
  ],
  CALENDAR_BOOKING_CONFIRMED: [
    UserRole.ROOT,
    UserRole.TENANT_ADMIN,
    UserRole.READ_ONLY,
    UserRole.NEIGHBOR,
  ],

  // System
  USER_ADDED: [UserRole.ROOT, UserRole.TENANT_ADMIN],
  PERMISSIONS_CHANGED: [
    UserRole.ROOT,
    UserRole.TENANT_ADMIN,
    UserRole.READ_ONLY,
    UserRole.GUARD,
    UserRole.NEIGHBOR,
  ],
  SESSION_EXPIRING: [
    UserRole.ROOT,
    UserRole.TENANT_ADMIN,
    UserRole.READ_ONLY,
    UserRole.GUARD,
    UserRole.NEIGHBOR,
  ],
} satisfies Record<R1NotificationType, UserRole[]>;

/**
 * Narrows an arbitrary NotificationType to an r1 type covered by the matrix.
 * Legacy types return false so recipient resolution can skip them safely.
 */
export function isR1NotificationType(
  type: NotificationType,
): type is R1NotificationType {
  return type in NOTIFICATION_ROLE_ACCESS;
}
