import { CalendarEventVisibility } from '@prisma/client';
import {
  CALENDAR_PERM,
  buildVisibilityFilter,
  canSeeVisibility,
  isValidVisibility,
  visibleVisibilitiesForPermissions,
} from './visibility.util';

const ALL = [
  CalendarEventVisibility.PUBLIC,
  CalendarEventVisibility.COUNCIL_ONLY,
  CalendarEventVisibility.PRIVATE,
];

describe('visibility.util — Phase 4 (permission-derived)', () => {
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

  it('calendar.viewPrivate sees every visibility level', () => {
    const perms = new Set([CALENDAR_PERM.viewPrivate]);
    expect(visibleVisibilitiesForPermissions(perms)).toEqual(ALL);
  });

  it('calendar.manage implies full visibility (a manager sees what it can edit)', () => {
    const perms = new Set([CALENDAR_PERM.manage]);
    expect(visibleVisibilitiesForPermissions(perms)).toEqual(ALL);
    expect(canSeeVisibility(perms, CalendarEventVisibility.PRIVATE)).toBe(true);
  });

  it('calendar.viewCouncil sees PUBLIC and COUNCIL_ONLY but not PRIVATE', () => {
    const perms = new Set([CALENDAR_PERM.viewCouncil]);
    expect(visibleVisibilitiesForPermissions(perms)).toEqual([
      CalendarEventVisibility.PUBLIC,
      CalendarEventVisibility.COUNCIL_ONLY,
    ]);
    expect(canSeeVisibility(perms, CalendarEventVisibility.PRIVATE)).toBe(false);
    expect(canSeeVisibility(perms, CalendarEventVisibility.COUNCIL_ONLY)).toBe(true);
  });

  it('only calendar.read (e.g. resident/guard/ungranted custom role) sees PUBLIC only', () => {
    const perms = new Set(['calendar.read']);
    expect(visibleVisibilitiesForPermissions(perms)).toEqual([CalendarEventVisibility.PUBLIC]);
    expect(canSeeVisibility(perms, CalendarEventVisibility.COUNCIL_ONLY)).toBe(false);
    expect(canSeeVisibility(perms, CalendarEventVisibility.PRIVATE)).toBe(false);
  });

  it('an empty permission set sees PUBLIC only (default-deny)', () => {
    expect(visibleVisibilitiesForPermissions(new Set())).toEqual([CalendarEventVisibility.PUBLIC]);
  });

  it('buildVisibilityFilter returns an empty filter for full-visibility callers', () => {
    expect(buildVisibilityFilter(new Set([CALENDAR_PERM.viewPrivate]))).toEqual({});
    expect(buildVisibilityFilter(new Set([CALENDAR_PERM.manage]))).toEqual({});
  });

  it('buildVisibilityFilter scopes council and public-only callers', () => {
    expect(buildVisibilityFilter(new Set([CALENDAR_PERM.viewCouncil]))).toEqual({
      visibility: {
        in: [CalendarEventVisibility.PUBLIC, CalendarEventVisibility.COUNCIL_ONLY],
      },
    });
    expect(buildVisibilityFilter(new Set(['calendar.read']))).toEqual({
      visibility: { in: [CalendarEventVisibility.PUBLIC] },
    });
  });
});
