import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * PrismaService — database client wrapper (Phase 5 / DB-008).
 *
 * Observability is intentionally minimal and safe:
 *  - `warn` / `error` engine events are always surfaced through the NestJS
 *    Logger (low-noise, no parameter data).
 *  - Slow-query logging is OFF by default and only activates when
 *    PRISMA_QUERY_LOGGING_ENABLED=true. When enabled, only queries at or above
 *    PRISMA_SLOW_QUERY_MS are logged, and only the SQL text + duration — never
 *    bound parameters — to avoid leaking personal or tenant data.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query' | 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly queryLoggingEnabled: boolean;
  private readonly slowQueryMs: number;

  constructor(configService: ConfigService) {
    // Constructor params may be referenced before super() as long as `this` is
    // not touched; the log config must be built here to reach the super() call.
    const queryLoggingEnabled = configService.get<boolean>(
      'database.queryLoggingEnabled',
      false,
    );
    const slowQueryMs = configService.get<number>('database.slowQueryMs', 500);

    super({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });

    this.queryLoggingEnabled = queryLoggingEnabled;
    this.slowQueryMs = slowQueryMs;

    // Slow-query logging — gated at runtime so the env flag fully controls
    // behaviour without code changes. Only SQL text + duration is logged.
    this.$on('query', (event: Prisma.QueryEvent) => {
      if (this.queryLoggingEnabled && event.duration >= this.slowQueryMs) {
        this.logger.debug(`slow query (${event.duration}ms): ${event.query}`);
      }
    });

    // Engine warnings / errors are always surfaced (no parameter data).
    this.$on('warn', (event: Prisma.LogEvent) => {
      this.logger.warn(event.message);
    });
    this.$on('error', (event: Prisma.LogEvent) => {
      this.logger.error(event.message);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
