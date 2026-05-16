import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtPayload } from '../types';

/**
 * Throttles by authenticated userId (JWT sub) instead of IP address.
 * This prevents one user from abusing the API without penalizing other
 * users who share the same corporate proxy or NAT IP.
 * Falls back to IP for unauthenticated requests (e.g. login endpoint).
 */
@Injectable()
export class ThrottlerUserGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as JwtPayload | undefined;
    if (user?.sub) {
      // Scope to condominiumId+userId so cross-tenant requests don't share quota
      const scope = user.condominiumId ? `${user.condominiumId}:${user.sub}` : user.sub;
      return scope;
    }
    // Fallback: IP-based (for public endpoints like /auth/login)
    const ip =
      (req['ip'] as string) ??
      ((req['ips'] as string[] | undefined)?.[0]) ??
      'unknown';
    return ip;
  }
}
