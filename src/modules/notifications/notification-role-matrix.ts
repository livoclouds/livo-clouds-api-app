import { NotificationType } from '@prisma/client';
import { UserRole } from '../../common/types';

/**
 * Legacy NotificationType values that predate the Notifications module. They
 * have no listeners and are excluded from the role matrix. Kept as an explicit
 * union so the exhaustiveness check below targets exactly the matrix-covered
 * types. `NEGATIVE_BALANCE` and `NEW_INCIDENT` were promoted out of this set
 * into the matrix when the per-user preferences page absorbed the legacy
 * Settings notifications tab.
 */
type LegacyNotificationType = 'FILE_IMPORTED' | 'IMPORT_ERROR' | 'NEW_USER';

/**
 * Notification types covered by the role matrix. Derived from the Prisma enum
 * by subtracting the legacy values so it stays in sync automatically: adding a
 * new value to NotificationType widens this union and breaks the `satisfies`
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
  // Imports — ROOT excluded: condominium-level operational events
  IMPORT_COMPLETED: [UserRole.TENANT_ADMIN, UserRole.READ_ONLY],
  IMPORT_FAILED: [UserRole.TENANT_ADMIN],
  IMPORT_WITH_WARNINGS: [UserRole.TENANT_ADMIN],
  IMPORT_DUPLICATE: [UserRole.TENANT_ADMIN],

  // Classification — ROOT excluded: condominium-level operational events
  CLASSIFICATION_REVIEW: [UserRole.TENANT_ADMIN],

  // Reconciliation — ROOT excluded: condominium-level operational events
  RECONCILIATION_RULE_MODIFIED: [UserRole.TENANT_ADMIN],

  // Calendar — ROOT excluded: condominium-level operational events
  CALENDAR_EVENT_CREATED: [UserRole.TENANT_ADMIN, UserRole.READ_ONLY],
  CALENDAR_EVENT_CANCELLED: [UserRole.TENANT_ADMIN, UserRole.READ_ONLY],
  CALENDAR_BOOKING_CONFIRMED: [
    UserRole.TENANT_ADMIN,
    UserRole.READ_ONLY,
    UserRole.NEIGHBOR,
  ],

  // Finance — ROOT excluded: condominium-level operational events
  NEGATIVE_BALANCE: [UserRole.TENANT_ADMIN],

  // Incidents
  NEW_INCIDENT: [UserRole.ROOT, UserRole.TENANT_ADMIN],

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
