# LivoClouds API — Technical Context

## Project
Multi-tenant condominium management SaaS REST API. Each condominium is an isolated tenant; all data is scoped by `condominiumId`.

## Stack
- **Runtime**: Node.js 22 (alpine Docker)
- **Framework**: NestJS 10 + Fastify adapter (not Express)
- **Language**: TypeScript 5.8 strict (`noImplicitAny`, `strictNullChecks`)
- **ORM**: Prisma 6.8 → PostgreSQL (Neon)
- **Auth**: passport-jwt + bcryptjs (12 rounds) + in-DB refresh tokens
- **Validation**: class-validator + class-transformer (global ValidationPipe)
- **Docs**: Swagger/OpenAPI at `GET /docs`
- **Module alias**: `@/*` → `src/*`

## Folder Structure
```
src/
├── main.ts              bootstrap (Fastify, Helmet, CORS, ValidationPipe, Swagger)
├── app.module.ts        global APP_FILTER + APP_GUARD + APP_INTERCEPTOR
├── config/              app | cors | database | jwt  (all use registerAs())
├── common/
│   ├── decorators/      @Public  @CurrentUser  @Roles
│   ├── filters/         GlobalExceptionFilter
│   ├── guards/          JwtAuthGuard  RolesGuard  CondominiumAccessGuard
│   ├── interceptors/    ResponseInterceptor
│   └── types/           UserRole enum  JwtPayload  PaginationQuery
├── prisma/              PrismaService (global module)
├── health/              GET /health  (@Public)
└── modules/             feature modules (see below)
```

## Feature Modules (`src/modules/`)

All 21 modules — each is `*.module.ts` + `*.controller.ts` + `*.service.ts` + `dto/`:

- `auth` — login, JWT issue/refresh, password reset
- `users` — platform and tenant user accounts
- `condominiums` — tenant records and access
- `residents` — residents and pets; server-side filtering/sorting
- `settings` — per-condominium configuration (`CondominiumSettings`)
- `transactions` — bank/financial transactions (core financial data)
- `imports` — Excel bank-export ingestion pipeline
- `classification` — rule-driven transaction classification engine
- `reconciliation-rules` — DB-driven reconciliation rules feeding classification
- `bank-profiles` — per-tenant bank-export column aliases / formats
- `collection` — payment collection and status tracking
- `petty-cash` — petty-cash movements with per-tenant folios
- `dashboard` — aggregated financial KPIs and summaries
- `reports` — financial reports
- `inventory` — common-area inventory items
- `calendar` — calendar events and terrace bookings
- `notifications` — in-app notifications and SSE feed
- `email` — transactional email via Resend
- `whatsapp` — WhatsApp messaging, conversations, FAQ, media
- `audit` — append-only audit logging
- `storage` — Cloudflare R2 file uploads

## Request Pipeline (applied globally in app.module.ts)
1. `GlobalExceptionFilter` — normalizes all thrown exceptions
2. `JwtAuthGuard` — validates Bearer JWT; bypassed by `@Public()`
3. `ResponseInterceptor` — wraps successful responses in `{ data: T }`

## Auth & Authorization

**Endpoints**:
- `POST /auth/login` — `@Public`; returns `accessToken` (15m) + `refreshToken` (7d)
- `POST /auth/refresh` — `@Public`; token rotation, old token revoked via `revokedAt`
- `POST /auth/logout` — `@Public`; revokes the refresh token in DB
- `POST /auth/forgot-password` — `@Public`; issues a password-reset token
- `POST /auth/reset-password` — `@Public`; consumes the token, sets a new password
- `GET /auth/me` — protected; returns the current user

**JwtPayload shape**:
```ts
{ sub: string; email: string; role: UserRole; condominiumId: string | null; condominiumSlug: string | null }
```

**Roles**: `ROOT | TENANT_ADMIN | READ_ONLY | GUARD | NEIGHBOR`

**Multi-tenancy guard** (`CondominiumAccessGuard`):
- Applied via `@UseGuards(CondominiumAccessGuard, RolesGuard)` on tenant-scoped controllers
- Extracts `:condominiumSlug` from route params, validates condominium exists + is active
- Sets `request.condominiumId` for downstream service calls
- ROOT bypasses tenant ownership check

**Route prefix pattern**: `/condominiums/:condominiumSlug/[resource]`

## API Response Format
```json
// Success
{ "data": <payload> }

// Error
{ "errors": [{ "code": "NOT_FOUND", "reason": "...", "datetime": "ISO8601", "path": "/..." }] }
```
NestJS exception classes map to HTTP codes: `NotFoundException` → 404, `ConflictException` → 409, etc.

## Database & ORM
- `DATABASE_URL`: pooled (PgBouncer) — for runtime queries
- `DIRECT_URL`: direct — for migrations only
- Schema: `prisma/schema.prisma` — see file for authoritative model list
- No migration history committed; run `prisma migrate dev` to generate

**Key models**: `Condominium` `User` `Resident` `ImportBatch` `Transaction` `FinancialMonthlySummary` `RefreshToken` `AuditLog`

**Key enums**: `UserRole` `ResidentType` `MovementType` `MovementStatus` `MovementCategory`
`CollectionStatus` `ClassificationStatus` `MatchSource` `UnitGeneralStatus`

## Key Patterns & Conventions
- **No repository layer** — services inject `PrismaService` and query directly
- **Soft deletes** — `deletedAt: DateTime?` on `User` + `Resident`; always filter `deletedAt: null`
- **safeSelect()** — private method on services; never expose `passwordHash` in responses
- **DTO validation** — every input DTO uses class-validator decorators + Swagger `@ApiProperty`; ValidationPipe is `whitelist: true`, `transform: true` (`forbidNonWhitelisted` intentionally removed — caused false 400s on valid requests)
- **Config** — each config file uses `registerAs('key', () => ({...}))`; `ConfigModule` is global
- **File uploads** — `@fastify/multipart`; 20 MB max per file, 5 files max
- **Password hashing** — `bcryptjs` with `SALT_ROUNDS = 12` (inline in auth + users services; `bcryptjs`, not `bcrypt`, for Vercel serverless compatibility)
- **Refresh token storage** — `RefreshToken` model; revocation via `revokedAt` field

## Endpoint & Data Access Standards

Invariants from the v1 API Performance & Risk Review (see `docs/api-review/v1/2026-05-13/`). Every new endpoint and every modification to an existing one must satisfy each of these — they are the contract that keeps the API ready to grow.

- **List endpoint shape.** Every collection-returning endpoint returns `{ data: T[], meta: { total, page, limit, totalPages } }` via `PaginatedResult<T>` from `src/common/types/index.ts`. The controller binds a `List<Name>Dto` with optional `page` (`@IsInt @Min(1)`, default `1`) and `limit` (`@IsInt @Min(1) @Max(N)`, sensible default — never `Infinity`). The service runs `Promise.all([findMany({ where, select|include, orderBy, skip, take }), count({ where })])`. Live default/max templates: residents 200/500, collection 200/1000, calendar 500/2000, audit & imports 50/200.
- **Tenant scoping.** Every `where` clause on a tenant-scoped endpoint derives `condominiumId` from `request.condominiumId` set by `CondominiumAccessGuard`. Never from query params, body, or path beyond the validated slug. `ROOT` bypass lives inside the guard — services do not re-implement it.
- **Projection.** Use Prisma `select` or `include` to return only the columns the response needs. No `findMany()` without an explicit projection on unbounded tables (`Transaction`, `AuditLog`, `ImportBatch`, `CalendarEvent`, `PettyCashMovement`).
- **Time-bounded endpoints** (`/calendar/events`, `/transactions`, `/audit/logs`) require validated `from`/`to` in the DTO; the service enforces the overlap predicate (`startDate < to AND endDate > from`).
- **Batched DB access.** When N items each need a DB lookup (e.g. SHA-256 dedup during import), issue ONE `findMany({ where: { x: { in: [...] } } })` and resolve from an in-memory map. Never loop with sequential `await` lookups.
- **Concurrency on unique constraints.** Tenant-scoped sequential identifiers (e.g. `PettyCashMovement.folio` with `@@unique([condominiumId, folio])`) wrap `count + create` in a bounded retry that catches `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` and throws `ConflictException` after the cap. Reference: `petty-cash.service.ts:82-117` (`MAX_FOLIO_RETRIES = 5`).
- **Throttling.** `@Throttle({ burst, sustained })` on endpoints whose work scales with payload (bulk reconcile, bulk classify, import process). Reference: the bulk endpoints in `classification.controller.ts`. The global `ThrottlerUserGuard` (`app.module.ts`) also applies a per-user burst/sustained limit.
- **Logging.** NestJS `Logger` only — never `console.*`. Instantiate per service: `private readonly logger = new Logger(ServiceName.name);`.
- **Swagger.** Off in production (`if (process.env.NODE_ENV !== 'production')` in `main.ts`).

## Schema & Migration Discipline

Schema changes are **evidence-driven**. Do NOT add composite indexes, new constraints, or migrations speculatively. Each change must be backed by one of: (a) representative `EXPLAIN ANALYZE` showing the current plan is the bottleneck, (b) production slow-query log evidence, or (c) measured row-count thresholds (e.g. `audit_logs > ~500k` per tenant, `import_batches > ~250k`). When the measurement infrastructure is missing, document the gap and defer — never guess. Write the smallest delta that solves the problem; use `CREATE INDEX CONCURRENTLY` on populated tables; never remove an `@@index` / `@@unique` without measured evidence its dependent query was retired. Reference: Phase 8 evaluation in `docs/api-review/v1/2026-05-13/progress/overall-progress.md`.

## Environment Variables
```
PORT                    default 3001
NODE_ENV
DATABASE_URL            pooled (pgbouncer=true)
DIRECT_URL              direct postgres connection
JWT_SECRET              minimum 32 chars
JWT_REFRESH_SECRET      minimum 32 chars, different from JWT_SECRET
JWT_EXPIRES_IN          default 15m
JWT_REFRESH_EXPIRES_IN  default 7d
CORS_ORIGIN             comma-separated list of allowed origins
```

## Scripts
```
npm run start:dev         nest start --watch
npm run build             nest build  →  dist/
npm run start:prod        node dist/main
npm run lint              eslint --fix
npm test                  jest
npm run prisma:generate   run after schema changes
npm run prisma:migrate    prisma migrate dev
npm run prisma:deploy     prisma migrate deploy (CI/production)
npm run prisma:seed       ts-node prisma/seed.ts
```

## Seed Data / Dev Credentials

`npm run prisma:seed` (`prisma/seed.ts`) populates 10 test condominiums with users,
residents, common areas, inventory, and bank data. Login accounts follow a fixed pattern:

| Account | Email | Password | Role |
|---|---|---|---|
| Platform root | `root@demo.com` | `Root1234!` | `ROOT` |
| Tenant admin | `admin@<slug>.com` | `Admin1234!` | `TENANT_ADMIN` |
| Read-only viewer | `view@<slug>.com` | `View1234!` | `READ_ONLY` |
| Guard | `guard@<slug>.com` | `Guard1234!` | `GUARD` |

Condominium slugs: `cotoalameda` · `cotolospatos` · `cotoencinos` · `bosquesdellago` ·
`cotovalledorado` · `vistaroble` · `puertadelsol` · `jardinesdelvalley` ·
`altosdelparque` · `senderosdelsbosque`. Not every condominium seeds all four account
types and some accounts are seeded inactive — see `prisma/seed.ts` for the exact matrix.

## Git & Version Control Rules

**Commits and pushes are NEVER performed automatically — no exceptions.**
After completing any implementation, refactor, fix, or documentation update — no matter how small — do not run `git add`, `git commit`, or `git push` unless the user explicitly requests it in that same message or a follow-up message. A prior commit instruction in the same session does NOT carry over to subsequent changes. Each commit requires its own fresh, explicit instruction. When in doubt: make the code changes, tell the user what changed, and wait.

**Never add Claude as a co-author.**
When the user explicitly asks to commit, the commit message must never include any `Co-Authored-By` trailer or any other attribution to Claude, an AI, or any automated tool. The commit must appear as solely authored by the git user configured in the repository.

**Commit message format.**
Every commit must follow this structure:

```
<concise descriptive title summarizing all changes>

<detailed body covering every file changed, every function added or
modified, behavioral changes before and after, reason for each decision,
migration or DB changes if any, and any side effects or edge cases
addressed>
```

- The title must be general enough to convey the full scope of the change set (not just one file or one fix).
- The body must be detailed: list each file modified, what changed in it, what functions or logic were added, altered, or removed, and why.
- Use the imperative mood in the title ("Add", "Fix", "Refactor", not "Added", "Fixed").
- Do not use conventional commit type prefixes (e.g. `feat:`, `fix:`) unless the user explicitly requests them.

## Web App Companion
The Next.js frontend lives at `~/code/github/livoclouds/livo-clouds-web-app`.

**Cross-repo rule**: When adding or changing an API endpoint that the web consumes, open the web repo and update the corresponding Next.js route handler and API client type. When the web adds a new proxy route, verify the API endpoint exists and the payload shape matches.

**Web app read permission**: Claude has standing permission to read any file in `~/code/github/livoclouds/livo-clouds-web-app` without asking.

## Known Gaps
- No dedicated logging library (NestJS built-in Logger + Fastify `logger: true`).
- No APM / slow-query log / `pg_stat_statements` / Prisma `$on('query')` instrumentation. Phase 8 (deferred index hardening) re-opens only when one of these provides measurement signal.
