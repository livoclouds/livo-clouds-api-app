import { CalendarEventVisibility } from '@prisma/client';
import { UserRole } from '../../common/types';
import {
  buildVisibilityFilter,
  canSeeVisibility,
  isValidVisibility,
  visibleVisibilitiesForRole,
} from './visibility.util';

describe('visibility.util — Phase 5C', () => {
  it('isValidVisibility accepts every enum value', () => {
    expect(isValidVisibility('PUBLIC')).toBe(true);
    expect(isValidVisibility('COUNCIL_ONLY')).toBe(true);
    expect(isValidVisibility('PRIVATE')).toBe(true);
  });

  it('isValidVisibility rejects unknown strings and non-strings', () => {
    expect(isValidVisibility('public')).toBe(false);
    expect(isValidVisibility('OWNER_ONLY')).toBe(false);
    expect(isValidVisibility(null)).toBe(false);
    expect(isValidVisibility(undefined)).toBe(false);
    expect(isValidVisibility(42)).toBe(false);
  });

  it('ROOT and TENANT_ADMIN can see every visibility level', () => {
    for (const role of [UserRole.ROOT, UserRole.TENANT_ADMIN]) {
      const allowed = visibleVisibilitiesForRole(role);
      expect(allowed).toEqual([
        CalendarEventVisibility.PUBLIC,
        CalendarEventVisibility.COUNCIL_ONLY,
        CalendarEventVisibility.PRIVATE,
      ]);
    }
  });

  it('READ_ONLY sees PUBLIC and COUNCIL_ONLY but not PRIVATE', () => {
    expect(visibleVisibilitiesForRole(UserRole.READ_ONLY)).toEqual([
      CalendarEventVisibility.PUBLIC,
      CalendarEventVisibility.COUNCIL_ONLY,
    ]);
    expect(canSeeVisibility(UserRole.READ_ONLY, CalendarEventVisibility.PRIVATE)).toBe(false);
    expect(canSeeVisibility(UserRole.READ_ONLY, CalendarEventVisibility.COUNCIL_ONLY)).toBe(true);
  });

  it('GUARD and RESIDENT see PUBLIC only', () => {
    for (const role of [UserRole.GUARD, UserRole.RESIDENT]) {
      expect(visibleVisibilitiesForRole(role)).toEqual([CalendarEventVisibility.PUBLIC]);
      expect(canSeeVisibility(role, CalendarEventVisibility.COUNCIL_ONLY)).toBe(false);
      expect(canSeeVisibility(role, CalendarEventVisibility.PRIVATE)).toBe(false);
    }
  });

  it('buildVisibilityFilter returns an empty filter for admins (no WHERE constraint)', () => {
    expect(buildVisibilityFilter(UserRole.ROOT)).toEqual({});
    expect(buildVisibilityFilter(UserRole.TENANT_ADMIN)).toEqual({});
  });

  it('buildVisibilityFilter scopes READ_ONLY, GUARD, and RESIDENT queries', () => {
    expect(buildVisibilityFilter(UserRole.READ_ONLY)).toEqual({
      visibility: {
        in: [CalendarEventVisibility.PUBLIC, CalendarEventVisibility.COUNCIL_ONLY],
      },
    });
    expect(buildVisibilityFilter(UserRole.GUARD)).toEqual({
      visibility: { in: [CalendarEventVisibility.PUBLIC] },
    });
    expect(buildVisibilityFilter(UserRole.RESIDENT)).toEqual({
      visibility: { in: [CalendarEventVisibility.PUBLIC] },
    });
  });
});
