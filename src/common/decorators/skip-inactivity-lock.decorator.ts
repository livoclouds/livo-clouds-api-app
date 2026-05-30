import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as exempt from the InactivityLockGuard so it remains reachable
 * while a session is locked. Apply to the endpoints that drive the lock itself
 * (unlock, heartbeat, session-state) and to logout, so a locked user can always
 * re-authenticate or leave.
 */
export const SKIP_INACTIVITY_LOCK_KEY = 'skipInactivityLock';
export const SkipInactivityLock = () =>
  SetMetadata(SKIP_INACTIVITY_LOCK_KEY, true);
