# LivoClouds API — Technical Context

## Project
Multi-tenant condominium management SaaS REST API. Each condominium is an isolated tenant; all data is scoped by `condominiumId`.

## Stack
- **Runtime**: Node.js 22 (alpine Docker)
- **Framework**: NestJS 10 + Fastify adapter (not Express)
- **Language**: TypeScript 5.8 strict (`noImplicitAny`, `strictNullChecks`)
- **ORM**: Prisma 6.8 → PostgreSQL (Neon)
- **Auth**: passport-jwt + bcrypt 12 rounds + in-DB refresh tokens
- **Validation**: class-validator + class-transformer (global ValidationPipe)
- **Docs**: Swagger/OpenAPI at `GET /docs`
- **Module alias**: `@/*` → `src/*`

## Folder Structure
```
src/
├── main.ts              bootstrap (Fastify, CORS, ValidationPipe, Swagger)
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
`auth` `users` `residents` `condominiums` `collection` `petty-cash`
`inventory` `settings` `audit` `dashboard` `reports` `imports` `notifications`
`classification` `storage` (Cloudflare R2 file uploads)

Each module: `*.module.ts` + `*.controller.ts` + `*.service.ts` + `dto/`

## Request Pipeline (applied globally in app.module.ts)
1. `GlobalExceptionFilter` — normalizes all thrown exceptions
2. `JwtAuthGuard` — validates Bearer JWT; bypassed by `@Public()`
3. `ResponseInterceptor` — wraps successful responses in `{ data: T }`

## Auth & Authorization

**Endpoints** (all `@Public()`):
- `POST /auth/login` — returns `accessToken` (15m) + `refreshToken` (7d)
- `POST /auth/refresh` — token rotation; old token revoked via `revokedAt`
- `POST /auth/logout` — revokes refresh token in DB
- `GET /auth/me` — protected

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
- **Password hashing** — bcrypt with `SALT_ROUNDS = 12` (defined inline in auth + users services)
- **Refresh token storage** — `RefreshToken` model; revocation via `revokedAt` field

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

## Git & Version Control Rules

**Commits and pushes are never performed automatically.**
After completing any implementation, refactor, or fix — no matter how small — do not run `git add`, `git commit`, or `git push` unless the user explicitly requests it in a follow-up message. Always wait for a direct instruction.

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
The Next.js frontend lives at `~/Code/github/livoclouds/livo-clouds-web-app`.

**Cross-repo rule**: When adding or changing an API endpoint that the web consumes, open the web repo and update the corresponding Next.js route handler and API client type. When the web adds a new proxy route, verify the API endpoint exists and the payload shape matches.

## Known Gaps
- No Helmet (no HTTP security headers)
- No rate limiting
- No dedicated logging library (NestJS built-in Logger + Fastify `logger: true`)
- Zero test files exist (Jest configured but no specs written)
- No pagination enforcement — `PaginationQuery` type defined but inconsistently applied
