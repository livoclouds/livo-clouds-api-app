import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  directUrl: process.env.DIRECT_URL,
  // Prisma observability (Phase 5 / DB-008). Both are optional and the feature
  // is OFF by default: query logging only activates when the flag is "true".
  queryLoggingEnabled: process.env.PRISMA_QUERY_LOGGING_ENABLED === 'true',
  // Only queries at or above this duration (ms) are logged when query logging
  // is enabled, keeping logs low-noise. Defaults to 500ms.
  slowQueryMs: Number(process.env.PRISMA_SLOW_QUERY_MS ?? 500),
}));
