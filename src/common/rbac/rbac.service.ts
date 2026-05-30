import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveEffectivePermissions } from './permission-catalog';

interface CacheEntry {
  perms: Set<string>;
  expiresAt: number;
}

/**
 * Resolves a user's effective permissions for enforcement (RBAC Phase 2).
 *
 * Effective permissions come live from the `roles` table (via the user's
 * assigned Role), with an in-memory cache so the hot path is not a DB hit per
 * request. The cache is short-lived AND explicitly invalidated on the few writes
 * that can change a user's effective set (role edits, user role reassignment),
 * so a permission change applies almost immediately without forcing a re-login.
 *
 * Falls back to the system preset for the legacy `role` enum when the user has
 * no `roleId` yet (pre-backfill safety), via resolveEffectivePermissions.
 */
@Injectable()
export class RbacService {
  private readonly cache = new Map<string, CacheEntry>();
  // Upper bound on staleness if an invalidation is ever missed. Writes invalidate
  // explicitly, so in practice changes apply on the next request.
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async getEffectivePermissions(userId: string): Promise<Set<string>> {
    const now = Date.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.perms;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        permissionOverrides: true,
        roleRef: { select: { permissions: true } },
      },
    });

    const perms = new Set(
      user
        ? resolveEffectivePermissions(user.roleRef, {
            overrides: user.permissionOverrides as string[] | null,
          })
        : [],
    );
    this.cache.set(userId, { perms, expiresAt: now + this.ttlMs });
    return perms;
  }

  /** True when the user holds AT LEAST ONE of the required permission keys. */
  async hasAny(userId: string, required: readonly string[]): Promise<boolean> {
    if (required.length === 0) return true;
    const perms = await this.getEffectivePermissions(userId);
    return required.some((k) => perms.has(k));
  }

  /** Drop one user's cached permissions (call after changing their role). */
  invalidateUser(userId: string): void {
    this.cache.delete(userId);
  }

  /** Drop the whole cache (call after a role's permission set changes). */
  invalidateAll(): void {
    this.cache.clear();
  }
}
