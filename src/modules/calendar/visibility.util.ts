import { CalendarEventVisibility } from '@prisma/client';
import { UserRole } from '../../common/types';

export const VISIBILITY_VALUES: CalendarEventVisibility[] = [
  CalendarEventVisibility.PUBLIC,
  CalendarEventVisibility.COUNCIL_ONLY,
  CalendarEventVisibility.PRIVATE,
];

export function isValidVisibility(value: unknown): value is CalendarEventVisibility {
  return typeof value === 'string' && VISIBILITY_VALUES.includes(value as CalendarEventVisibility);
}

export function visibleVisibilitiesForRole(role: UserRole): CalendarEventVisibility[] {
  if (role === UserRole.ROOT || role === UserRole.TENANT_ADMIN) {
    return [...VISIBILITY_VALUES];
  }
  if (role === UserRole.READ_ONLY) {
    return [CalendarEventVisibility.PUBLIC, CalendarEventVisibility.COUNCIL_ONLY];
  }
  return [CalendarEventVisibility.PUBLIC];
}

export function canSeeVisibility(role: UserRole, visibility: CalendarEventVisibility): boolean {
  return visibleVisibilitiesForRole(role).includes(visibility);
}

export function buildVisibilityFilter(role: UserRole): { visibility?: { in: CalendarEventVisibility[] } } {
  const allowed = visibleVisibilitiesForRole(role);
  if (allowed.length === VISIBILITY_VALUES.length) return {};
  return { visibility: { in: allowed } };
}
