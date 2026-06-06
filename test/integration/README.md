# Integration tests

DB-backed tests that exercise service layers against a **real PostgreSQL** (never a
mocked Prisma). The first suite covers the core financial pipeline:
**import → classification → reconciliation → monthly summary → dashboard KPIs**
(`pipeline.integration.spec.ts`).

These run in their own lane (`pnpm test:integration`) and are **excluded from the
unit lane** (`pnpm test`, whose Jest `rootDir` is `src/`), so contributors without a
database keep a green `pnpm test`.

## Running locally

You need a **throwaway** Postgres — the harness `TRUNCATE`s, so never point it at a
real tenant DB. Two easy options:

1. **Ephemeral Neon branch** (recommended — you already use Neon): create a branch in
   the Neon console and copy its connection string.
2. **Local Docker Postgres:**
   ```bash
   docker run --rm -d --name livo-it -p 5433:5432 \
     -e POSTGRES_USER=prisma -e POSTGRES_PASSWORD=prisma -e POSTGRES_DB=livo_it \
     postgres:16-alpine
   export TEST_DATABASE_URL=postgresql://prisma:prisma@localhost:5433/livo_it
   ```

Then apply the schema and run:

```bash
export TEST_DATABASE_URL=...            # throwaway DB
DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL pnpm prisma migrate deploy
pnpm test:integration
```

When `TEST_DATABASE_URL` is unset the suite **skips itself** (it does not fail).

## CI

The `integration-tests` job in `.github/workflows/ci.yml` provisions a
`postgres:16-alpine` service container, runs `prisma migrate deploy` against it, then
`pnpm test:integration --runInBand`. It runs on every PR and push to `main`.

## Adding a suite

- Name files `*.integration.spec.ts` under `test/integration/`.
- Build the context with `createPipelineContext()` and tear down with
  `closePipelineContext()`; call `resetDb()` in `beforeEach`.
- Wrap the suite in `describeIntegration` (skips when no DB is configured).
- Seed each test's own condominium (fresh `slug`) so the settings cache never
  collides across tests.
