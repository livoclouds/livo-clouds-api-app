import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

/**
 * Marks a route (or controller) with the permission key(s) required to access it
 * (RBAC Phase 2). Semantics are ANY-OF: holding at least one of the listed keys
 * grants access. Enforced by PermissionsGuard against the user's effective
 * permissions. A route with no @RequirePermission is not permission-gated.
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
