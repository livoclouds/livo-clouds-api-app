import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Canonical shape of a cached condominium settings row. Always loaded with the
 * `condominium` relation fields that `SettingsService.findOne` returns, so a
 * single cache entry serves every consumer (settings page, dashboard KPIs,
 * classification terrace keywords).
 */
export type CachedCondominiumSettings = Prisma.CondominiumSettingsGetPayload<{
  include: {
    condominium: { select: { name: true; primaryColor: true; slug: true } };
  };
}>;

interface CacheEntry {
  value: CachedCondominiumSettings | null;
  expiresAt: number;
}

/**
 * Phase 6 (A5) — small, dependency-free, tenant-scoped TTL cache for the
 * frequently-read, rarely-changed `condominiumSettings` row.
 *
 * Design decisions:
 * - **Key = condominiumId only.** No cross-tenant leak is possible by
 *   construction; an entry can never be served to another condominium.
 * - **Caches the raw DB row only.** The presigned logo URL is per-request and
 *   expires, so it is never cached — `SettingsService.findOne` signs it on read,
 *   outside this cache.
 * - **TTL is a staleness backstop.** Every settings write calls
 *   {@link invalidate}; the TTL only bounds staleness if an invalidation path is
 *   ever missed. Configurable via `SETTINGS_CACHE_TTL_MS` (default 60000); a
 *   value of `0` (or less) disables caching entirely so the feature is
 *   flag-killable without a code change.
 *
 * Known limitation: the cache is **per process instance**. On multi-instance /
 * serverless deployments a settings write invalidates only the instance that
 * handled it; other instances serve the previous value until the TTL expires.
 * This is acceptable for rarely-changed configuration. Cross-instance
 * invalidation (Redis pub/sub) is intentionally deferred — no external
 * infrastructure is introduced in this phase.
 */
@Injectable()
export class SettingsCacheService {
  private readonly logger = new Logger(SettingsCacheService.name);
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(private readonly prisma: PrismaService) {
    const parsed = Number(process.env.SETTINGS_CACHE_TTL_MS ?? 60_000);
    this.ttlMs = Number.isFinite(parsed) ? parsed : 60_000;
    if (this.ttlMs <= 0) {
      this.logger.log('Settings cache disabled (SETTINGS_CACHE_TTL_MS <= 0)');
    }
  }

  /**
   * Returns the condominium settings row, served from cache when a fresh entry
   * exists. Returns `null` when the condominium has no settings row yet — the
   * caller decides whether that is an error (settings page) or a tolerated
   * absence (dashboard/classification fall back to defaults).
   */
  async getSettings(
    condominiumId: string,
  ): Promise<CachedCondominiumSettings | null> {
    if (this.ttlMs <= 0) {
      return this.load(condominiumId);
    }

    const now = Date.now();
    const hit = this.store.get(condominiumId);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    const value = await this.load(condominiumId);
    this.store.set(condominiumId, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  /**
   * Drops the cached entry for a condominium. Called after every settings write
   * so the next read reflects the change immediately on this instance.
   */
  invalidate(condominiumId: string): void {
    this.store.delete(condominiumId);
  }

  private load(
    condominiumId: string,
  ): Promise<CachedCondominiumSettings | null> {
    return this.prisma.condominiumSettings.findUnique({
      where: { condominiumId },
      include: {
        condominium: { select: { name: true, primaryColor: true, slug: true } },
      },
    });
  }
}
