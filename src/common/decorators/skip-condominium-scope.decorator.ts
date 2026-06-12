import { SetMetadata } from '@nestjs/common';

export const SKIP_CONDOMINIUM_SCOPE = 'skipCondominiumScope';

/**
 * Marks a route (or controller) as NOT condominium-scoped so that
 * `CondominiumAccessGuard` skips tenant resolution entirely.
 *
 * ENGINE-057: the guard fails closed when it cannot resolve a condominium
 * slug — a slug-less route would otherwise proceed with
 * `request.condominiumId` undefined, and Prisma silently drops an undefined
 * `condominiumId` filter, matching every tenant's rows. Routes that are
 * genuinely global (e.g. support-article metrics, whose `:slug` is an
 * article slug, not a condominium slug) must opt out explicitly.
 */
export const SkipCondominiumScope = () =>
  SetMetadata(SKIP_CONDOMINIUM_SCOPE, true);
