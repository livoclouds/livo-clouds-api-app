import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Observable } from 'rxjs';
import type { JwtPayload } from '../types';

/**
 * Stamps every Sentry event captured during a request with the tenant + actor.
 *
 * Interceptors run after the global guards, so by this point `request.user`
 * (set by `JwtAuthGuard`) and `request.condominiumId` (set by
 * `CondominiumAccessGuard` on tenant-scoped routes) are populated. Tagging the
 * per-request isolation scope means a captured exception is immediately
 * triageable by condominium — the single most useful dimension for a
 * multi-tenant pilot.
 *
 * No-op when Sentry has no DSN (the SDK calls are cheap stubs), so this is safe
 * to keep wired regardless of whether Sentry is provisioned.
 */
@Injectable()
export class SentryContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      condominiumId?: string;
    }>();

    const scope = Sentry.getIsolationScope();
    const user = request.user;

    if (user) {
      scope.setUser({ id: user.sub, email: user.email });
      scope.setTag('role', user.role);
    }
    scope.setTag(
      'condominiumId',
      request.condominiumId ?? user?.condominiumId ?? 'none',
    );

    return next.handle();
  }
}
