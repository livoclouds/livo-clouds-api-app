import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_INACTIVITY_LOCK_KEY } from '../decorators/skip-inactivity-lock.decorator';
import { JwtPayload } from '../types';

// 423 Locked — not present in Nest's HttpStatus enum, so referenced by value.
const HTTP_STATUS_LOCKED = 423;

/**
 * Server-authoritative in-app screen lock.
 *
 * Runs after JwtAuthGuard (so request.user is populated). For every protected,
 * non-whitelisted request it resolves the session row referenced by the access
 * token's `sid` and rejects with 423 when the session is locked — either
 * explicitly (lockedAt set) or because it has been idle longer than the user's
 * inactivityLockMinutes. The first idle hit also persists lockedAt so the lock
 * is sticky until an explicit unlock.
 *
 * It never refreshes lastActivityAt: only the heartbeat endpoint does, which is
 * what separates genuine user activity from background polling.
 */
@Injectable()
export class InactivityLockGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_INACTIVITY_LOCK_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    const sid = user?.sid;

    // No session id means a token minted before this feature shipped. Those
    // access tokens live at most ~15 min; degrade gracefully rather than lock
    // everyone out during the rollout window.
    if (!sid) return true;

    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sid },
      select: {
        lastActivityAt: true,
        lockedAt: true,
        revokedAt: true,
        user: { select: { inactivityLockMinutes: true } },
      },
    });

    // Session unknown or already revoked — not a lock condition; let the normal
    // auth/refresh flow deal with it.
    if (!session || session.revokedAt) return true;

    if (session.lockedAt) {
      this.throwLocked();
    }

    const minutes = session.user.inactivityLockMinutes;
    const last = session.lastActivityAt;
    if (last && Date.now() - last.getTime() > minutes * 60_000) {
      // Make the lock sticky so a later burst of activity can't silently clear it.
      await this.prisma.refreshToken.update({
        where: { id: sid },
        data: { lockedAt: new Date() },
      });
      this.throwLocked();
    }

    return true;
  }

  private throwLocked(): never {
    throw new HttpException(
      { code: 'SESSION_LOCKED', reason: 'auth.locked' },
      HTTP_STATUS_LOCKED,
    );
  }
}
