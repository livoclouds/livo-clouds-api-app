import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Maximum time the readiness probe waits for the database round-trip before it
 * gives up and reports the API as not-ready. Kept short so a stalled pool never
 * piles up hung readiness requests (the probe is `@Public` + unthrottled).
 */
export const READINESS_TIMEOUT_MS = 2000;

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness probe — process is up. Intentionally unconditional (no DB probe):
   * orchestrator liveness checks must NOT flap on a transient database blip, or
   * the container gets killed during a recoverable outage. Use `/health/ready`
   * for the readiness signal that gates client auto-recovery.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'API liveness check (process up)' })
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Readiness probe — the API can actually serve traffic (database reachable).
   * A cheap `SELECT 1`, timeout-bounded so a stalled connection pool surfaces as
   * 503 rather than hanging. This is the signal the web app polls to decide when
   * an outage has truly recovered, so it must reflect dependency health, not just
   * process liveness.
   */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'API readiness probe (database connectivity)' })
  @ApiResponse({ status: 200, description: 'API is ready to serve traffic.' })
  @ApiResponse({ status: 503, description: 'API is not ready (database unreachable).' })
  async ready() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('readiness_timeout')),
          READINESS_TIMEOUT_MS,
        );
      });
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return { status: 'ready' };
    } catch (err) {
      const reason =
        err instanceof Error && err.message === 'readiness_timeout'
          ? 'timeout'
          : 'db_unreachable';
      throw new ServiceUnavailableException({ status: 'not_ready', reason });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
