import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RateBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Per-user sliding-hour rate limiter for the media proxy. Keeps a single
 * in-memory bucket per user; this is sufficient for a single-instance deploy.
 * Multi-instance deployments would under-enforce — see known-issues.md.
 */
@Injectable()
export class WhatsAppMediaRateLimitService {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly limit: number;
  private readonly windowMs = 60 * 60 * 1000;

  constructor(config: ConfigService) {
    this.limit = config.get<number>('whatsapp.mediaProxyRateLimit', 200);
  }

  consume(userId: string): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(userId);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(userId, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterSec: 0 };
    }

    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: this.limit - bucket.count,
      retryAfterSec: 0,
    };
  }
}
