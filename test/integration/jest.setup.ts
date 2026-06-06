/**
 * Runs before each integration test file (jest `setupFiles`), i.e. BEFORE any
 * module — including PrismaService — is imported. PrismaClient reads DATABASE_URL
 * at construction time, so the test DB URL must be in place here.
 *
 * TEST_DATABASE_URL is the explicit opt-in knob; when present it overrides
 * DATABASE_URL (and DIRECT_URL) so the suite can never accidentally hit a real
 * tenant database. When absent, the suite skips itself (see `describeIntegration`).
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
}
