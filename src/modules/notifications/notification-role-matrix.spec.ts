import { NotificationType, UserRole } from '@prisma/client';
import {
  isR1NotificationType,
  NOTIFICATION_ROLE_ACCESS,
} from './notification-role-matrix';
import { NOTIFICATION_R1_TYPES } from './notifications.constants';

describe('NOTIFICATION_ROLE_ACCESS', () => {
  it('covers exactly the 12 r1 notification types', () => {
    const matrixKeys = Object.keys(NOTIFICATION_ROLE_ACCESS).sort();
    const r1Keys = [...NOTIFICATION_R1_TYPES].sort();
    expect(matrixKeys).toEqual(r1Keys);
    expect(matrixKeys).toHaveLength(12);
  });

  it('maps each notification type to its documented role list', () => {
    const expected: Record<string, UserRole[]> = {
      IMPORT_COMPLETED: [
        UserRole.ROOT,
        UserRole.TENANT_ADMIN,
        UserRole.READ_ONLY,
      ],
      IMPORT_FAILED: [UserRole.ROOT, UserRole.TENANT_ADMIN],
      IMPORT_WITH_WARNINGS: [UserRole.ROOT, UserRole.TENANT_ADMIN],
      IMPORT_DUPLICATE: [UserRole.ROOT, UserRole.TENANT_ADMIN],
      CLASSIFICATION_REVIEW: [UserRole.ROOT, UserRole.TENANT_ADMIN],
      RECONCILIATION_RULE_MODIFIED: [UserRole.ROOT, UserRole.TENANT_ADMIN],
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
    };
    for (const [type, roles] of Object.entries(expected)) {
      const actual = NOTIFICATION_ROLE_ACCESS[
        type as keyof typeof NOTIFICATION_ROLE_ACCESS
      ] as UserRole[];
      expect([...actual].sort()).toEqual([...roles].sort());
    }
  });

  it('grants each role exactly the expected notification types', () => {
    const typesForRole = (role: UserRole): string[] =>
      Object.entries(NOTIFICATION_ROLE_ACCESS)
        .filter(([, roles]) => (roles as UserRole[]).includes(role))
        .map(([type]) => type)
        .sort();

    const allTypes = [...NOTIFICATION_R1_TYPES].sort();
    // ROOT and TENANT_ADMIN receive every r1 type.
    expect(typesForRole(UserRole.ROOT)).toEqual(allTypes);
    expect(typesForRole(UserRole.TENANT_ADMIN)).toEqual(allTypes);
    expect(typesForRole(UserRole.READ_ONLY)).toEqual(
      [
        'IMPORT_COMPLETED',
        'CALENDAR_EVENT_CREATED',
        'CALENDAR_EVENT_CANCELLED',
        'CALENDAR_BOOKING_CONFIRMED',
        'PERMISSIONS_CHANGED',
        'SESSION_EXPIRING',
      ].sort(),
    );
    // GUARD only receives the two transverse system notifications.
    expect(typesForRole(UserRole.GUARD)).toEqual(
      ['PERMISSIONS_CHANGED', 'SESSION_EXPIRING'].sort(),
    );
    // NEIGHBOR receives personal booking confirmations plus system events.
    expect(typesForRole(UserRole.NEIGHBOR)).toEqual(
      ['CALENDAR_BOOKING_CONFIRMED', 'PERMISSIONS_CHANGED', 'SESSION_EXPIRING'].sort(),
    );
  });

  it('lists a non-empty set of valid roles for every type', () => {
    const validRoles = new Set<string>(Object.values(UserRole));
    for (const roles of Object.values(NOTIFICATION_ROLE_ACCESS)) {
      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) {
        expect(validRoles.has(role)).toBe(true);
      }
    }
  });

  it('narrows r1 types and rejects legacy types via isR1NotificationType', () => {
    expect(isR1NotificationType(NotificationType.IMPORT_COMPLETED)).toBe(true);
    expect(isR1NotificationType(NotificationType.SESSION_EXPIRING)).toBe(true);
    expect(isR1NotificationType(NotificationType.NEGATIVE_BALANCE)).toBe(false);
    expect(isR1NotificationType(NotificationType.FILE_IMPORTED)).toBe(false);
  });
});
