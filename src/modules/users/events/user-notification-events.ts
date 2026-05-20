/**
 * Domain events emitted by `UsersService` for the Notifications module's
 * `UsersNotificationsListener` (Phase 3).
 */

export const USER_ADDED_EVENT = 'user.added';
export const USER_PERMISSIONS_CHANGED_EVENT = 'user.permissions_changed';

export interface UserAddedEventPayload {
  condominiumId: string;
  /** The newly created user. */
  userId: string;
  email: string;
  role: string;
  /** User who created the account; excluded from the recipient set. */
  actorUserId: string;
}

export interface UserPermissionsChangedEventPayload {
  condominiumId: string;
  /** The user whose role changed. */
  userId: string;
  beforeRole: string;
  afterRole: string;
  actorUserId: string;
}
