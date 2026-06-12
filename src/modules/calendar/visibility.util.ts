import { CalendarEventVisibility } from '@prisma/client';

export const VISIBILITY_VALUES: CalendarEventVisibility[] = [
  CalendarEventVisibility.PUBLIC,
  CalendarEventVisibility.COUNCIL_ONLY,
  CalendarEventVisibility.PRIVATE,
];

export function isValidVisibility(value: unknown): value is CalendarEventVisibility {
  return typeof value === 'string' && VISIBILITY_VALUES.includes(value as CalendarEventVisibility);
}

// ─── Permission-derived visibility (Phase 4 — CAL-001/032) ─────────────────────
// The visible-tier set is derived from the caller's LIVE effective permissions
// (resolved per request via RbacService), not from the stale JWT role claim. A
// custom role only sees what it has been explicitly granted; a manager sees all.
export const CALENDAR_PERM = {
  manage: 'calendar.manage',
  viewCouncil: 'calendar.viewCouncil',
  viewPrivate: 'calendar.viewPrivate',
} as const;

/**
 * Visibility tiers a caller may read, derived from effective permissions:
 *  - `calendar.viewPrivate` OR `calendar.manage` → PUBLIC + COUNCIL_ONLY + PRIVATE
 *    (a manager must be able to see every event it can edit).
 *  - `calendar.viewCouncil` → PUBLIC + COUNCIL_ONLY (auditor / council).
 *  - neither → PUBLIC only (residents, guards, ungranted custom roles).
 */
export function visibleVisibilitiesForPermissions(
  perms: ReadonlySet<string>,
): CalendarEventVisibility[] {
  if (perms.has(CALENDAR_PERM.viewPrivate) || perms.has(CALENDAR_PERM.manage)) {
    return [...VISIBILITY_VALUES];
  }
  if (perms.has(CALENDAR_PERM.viewCouncil)) {
    return [CalendarEventVisibility.PUBLIC, CalendarEventVisibility.COUNCIL_ONLY];
  }
  return [CalendarEventVisibility.PUBLIC];
}

export function canSeeVisibility(
  perms: ReadonlySet<string>,
  visibility: CalendarEventVisibility,
): boolean {
  return visibleVisibilitiesForPermissions(perms).includes(visibility);
}

export function buildVisibilityFilter(
  perms: ReadonlySet<string>,
): { visibility?: { in: CalendarEventVisibility[] } } {
  const allowed = visibleVisibilitiesForPermissions(perms);
  if (allowed.length === VISIBILITY_VALUES.length) return {};
  return { visibility: { in: allowed } };
}
