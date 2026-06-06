/**
 * Sentry initialisation — MUST be imported as the very first line of `main.ts`,
 * before any other module is required, so the SDK can instrument the runtime.
 *
 * `dotenv/config` is loaded here because this file runs before Nest bootstraps,
 * and therefore before `ConfigModule` reads the `.env` file — without it
 * `SENTRY_DSN` would be invisible during local development. In production the
 * host (e.g. Vercel) injects env vars at the process level, so dotenv is a no-op.
 *
 * Safe-by-default: with no `SENTRY_DSN` the SDK is disabled and sends nothing.
 * Sentry stays fully dormant until a DSN is provisioned from sentry.io.
 */
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  environment:
    process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  // Performance tracing is opt-in and off by default (0). Raise via env when a
  // tracing budget is wanted; error capture does not depend on this.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
});
