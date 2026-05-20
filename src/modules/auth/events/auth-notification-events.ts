/**
 * Auth domain event contract for the Notifications module's
 * `AuthNotificationsListener` (Phase 3).
 *
 * The listener is fully implemented and tested, but no producer emits this
 * event in Phase 3: refresh tokens rotate with a fresh TTL on every refresh
 * and the session window is a client-side construct, so the API has no
 * reliable server-side near-expiry hook. A client-driven emitter is deferred
 * to Phase 4. See OQ-NT-15 in the Notifications known-issues document.
 */

export const SESSION_EXPIRING_EVENT = 'session.expiring_soon';

export interface SessionExpiringEventPayload {
  /** The user whose session is near expiry — the sole recipient. */
  userId: string;
  /** Tenant scope; null for ROOT users with no active condominium. */
  condominiumId: string | null;
  minutesRemaining: number;
}
