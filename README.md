# LivoClouds API

Multi-tenant SaaS REST API for condominium management. Each condominium is an isolated tenant; all data is scoped by `condominiumId`. Built with NestJS + Fastify, Prisma, and JWT authentication. Designed to serve a web application and future mobile clients via Bearer Token.

---

## Table of Contents

1. [Project Description](#1-project-description)
2. [Technologies](#2-technologies)
3. [Multi-tenant Architecture](#3-multi-tenant-architecture)
4. [Project Structure](#4-project-structure)
5. [Environment Variables](#5-environment-variables)
6. [Quick Start](#6-quick-start)
7. [Scripts](#7-scripts)
8. [Environment Configuration](#8-environment-configuration)
9. [Prisma](#9-prisma)
10. [Database & Data Model](#10-database--data-model)
11. [Seed & Dummy Data](#11-seed--dummy-data)
12. [Authentication & Authorization](#12-authentication--authorization)
13. [Test Accounts](#13-test-accounts)
14. [API Endpoints](#14-api-endpoints)
15. [Response Format](#15-response-format)
16. [Error Handling](#16-error-handling)
17. [Web Integration Guide](#17-web-integration-guide)
18. [Frontend/Backend Contract](#18-frontendbackend-contract)
19. [Conventions for New Endpoints](#19-conventions-for-new-endpoints)
20. [Web & Mobile Considerations](#20-web--mobile-considerations)
21. [Security](#21-security)
22. [Docker](#22-docker)
23. [Onboarding Flow](#23-onboarding-flow)
24. [Project Conventions](#24-project-conventions)
25. [Known Gaps](#25-known-gaps)
26. [Troubleshooting](#26-troubleshooting)
27. [Notes for AI Assistants](#27-notes-for-ai-assistants)

---

## 1. Project Description

LivoClouds API is a multi-tenant condominium management platform backend. It manages condominiums, residents, fee collection, petty cash, inventory, file imports, audit logs, and notifications — all within isolated tenant boundaries.

Each condominium operates as an independent tenant identified by a unique `slug`. The `CondominiumAccessGuard` enforces strict data isolation: every service query is filtered by `condominiumId`, and non-ROOT users can only access data belonging to their own condominium.

The API exposes a RESTful interface documented via Swagger/OpenAPI at `/docs`. It is designed to serve a frontend SaaS application and is intended to also serve future mobile clients — all via Bearer Token authentication, with no dependency on browser cookies or sessions.

Data isolation is the responsibility of the server. Clients do not decide which tenant they belong to — the API resolves this from the authenticated user's JWT.

---

## 2. Technologies

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 22 (Alpine) | Runtime |
| NestJS | 10 | Application framework |
| Fastify | (via `@nestjs/platform-fastify`) | HTTP adapter (replaces Express) |
| TypeScript | 5.8 | Language (strict mode, `noImplicitAny`, `strictNullChecks`) |
| Prisma | 6.8 | ORM + migrations |
| PostgreSQL | (Neon serverless) | Primary database |
| passport-jwt | latest | JWT strategy for Passport |
| bcrypt | 5.1 | Password hashing (12 salt rounds) |
| class-validator + class-transformer | latest | DTO validation + transformation |
| Swagger/OpenAPI | (`@nestjs/swagger`) | API documentation at `/docs` |
| `@fastify/multipart` | latest | File upload handling (20 MB max, 5 files max) |
| `@fastify/static` | latest | Static file serving |
| Docker | — | Multi-stage containerization |
| docker-compose | — | Local service orchestration |
| Jest | 29.7 | Test runner (configured, no specs yet) |
| ESLint + Prettier | — | Linting and formatting |

Module alias: `@/*` maps to `src/*` (configured in `tsconfig.json`).

---

## 3. Multi-tenant Architecture

Each condominium is an isolated tenant identified by a unique `slug` in URLs and a UUID `condominiumId` in the database. All data isolation is enforced server-side — clients do not decide which tenant they belong to.

### How isolation works

1. The JWT payload includes `condominiumId` and `condominiumSlug`, set at login time and signed by the server.
2. Tenant-scoped routes use `:condominiumSlug` as a path parameter (e.g. `/condominiums/cotoalameda/residents`).
3. `CondominiumAccessGuard` (applied per-controller) resolves the slug to a database record, validates that the condominium `isActive = true`, and verifies the authenticated user belongs to it.
4. It sets `request.condominiumId` — this is the authoritative tenant context for all downstream service calls.
5. Every service query filters by `condominiumId` at the Prisma level.
6. Write operations use `updateMany({ where: { id, condominiumId } })` to prevent IDOR attacks — a write cannot affect records from another tenant even if the ID is guessed.

ROOT users bypass the ownership check and can access any active condominium.

### What the web is responsible for

- Read `user.condominiumSlug` from the login response to build all tenant-scoped URLs.
- Send the correct `:condominiumSlug` in the URL — the API resolves the `condominiumId` internally.
- Do **not** send `condominiumId` in request bodies as a source of authorization — the API ignores it and uses only the guard-resolved value.

### What the API guarantees

- A user cannot read or write data from a condominium they do not belong to (403 if attempted).
- All queries are filtered by the server-resolved `condominiumId`, not a client-provided value.
- The `CondominiumAccessGuard` rejects requests if the condominium slug is invalid or the condominium is inactive.
- Write operations are IDOR-safe: the `condominiumId` guard prevents cross-tenant mutations even if an attacker guesses a foreign resource ID.

### Roles and access levels

| Role | Scope | Write access |
|---|---|---|
| `ROOT` | All condominiums (platform-wide) | Full |
| `TENANT_ADMIN` | Own condominium only | Full within condominium |
| `READ_ONLY` | Own condominium only | None |
| `GUARD` | Own condominium only | Limited (specific endpoints) |
| `NEIGHBOR` | Own condominium only | None (read own data only) |

### Email uniqueness

`User` has a compound unique constraint `@@unique([condominiumId, email])`. Email must be unique within a condominium, not globally. ROOT users (`condominiumId = null`) are subject to a global email uniqueness check enforced at the service layer.

---

## 4. Project Structure

```
livo-clouds-api-app/
├── .env                          # Runtime environment variables (git-ignored)
├── .env.example                  # Template — copy to .env and fill in values
├── .gitignore
├── .dockerignore
├── CLAUDE.md                     # AI assistant context (technical reference)
├── README.md                     # This file
├── Dockerfile                    # Multi-stage build (builder + runner)
├── docker-compose.yml            # Service orchestration
├── nest-cli.json                 # NestJS CLI configuration
├── tsconfig.json                 # TypeScript config (strict, @/* alias)
├── tsconfig.build.json           # Build-specific TS config (excludes tests)
├── package.json                  # Scripts + dependencies
├── package-lock.json
├── dist/                         # Compiled output (generated by npm run build)
├── node_modules/
├── prisma/
│   ├── schema.prisma             # Database schema (16 models, 19 enums)
│   ├── seed.ts                   # Seed script — 10 condominiums, realistic multi-tenant data
│   └── migrations/               # Applied migration files
│       └── 20260509080015_initial_migration/
│           └── migration.sql
└── src/
    ├── main.ts                   # Bootstrap: Fastify, CORS, ValidationPipe, Swagger, port
    ├── app.module.ts             # Root module: ConfigModule, PrismaModule, all feature modules
    │                             #   Global providers: APP_FILTER, APP_GUARD, APP_INTERCEPTOR
    ├── config/
    │   ├── app.config.ts         # PORT, NODE_ENV — uses registerAs('app', ...)
    │   ├── cors.config.ts        # CORS_ORIGIN (parsed from comma-separated string)
    │   ├── database.config.ts    # DATABASE_URL, DIRECT_URL
    │   └── jwt.config.ts         # JWT_SECRET, JWT_REFRESH_SECRET, expirations
    ├── common/
    │   ├── decorators/
    │   │   ├── public.decorator.ts         # @Public() — bypasses JwtAuthGuard
    │   │   ├── current-user.decorator.ts   # @CurrentUser() — injects JwtPayload
    │   │   └── roles.decorator.ts          # @Roles(...UserRole) — sets role metadata
    │   ├── guards/
    │   │   ├── jwt-auth.guard.ts           # Global guard; validates Bearer JWT
    │   │   ├── roles.guard.ts              # Role-based access control
    │   │   └── condominium-access.guard.ts # Multi-tenant isolation (slug → condominiumId)
    │   ├── filters/
    │   │   └── http-exception.filter.ts    # Global error normalizer → { errors: [...] }
    │   ├── interceptors/
    │   │   └── response.interceptor.ts     # Wraps success responses → { data: T }
    │   └── types/
    │       └── index.ts                    # UserRole enum, JwtPayload, PaginationQuery
    ├── prisma/
    │   ├── prisma.module.ts      # Global NestJS module wrapping PrismaClient
    │   └── prisma.service.ts     # PrismaService — onModuleInit/Destroy lifecycle
    ├── health/
    │   └── health.controller.ts  # GET /health — public, no auth
    └── modules/                  # 13 feature modules
        ├── auth/
        │   ├── auth.controller.ts          # POST /auth/login, /refresh, /logout; GET /auth/me
        │   ├── auth.service.ts             # JWT generation, password validation, token rotation
        │   ├── auth.module.ts
        │   ├── strategies/
        │   │   └── jwt.strategy.ts         # Passport JWT strategy
        │   └── dto/
        │       ├── login.dto.ts
        │       └── refresh-token.dto.ts
        ├── users/
        │   ├── users.controller.ts         # CRUD — /condominiums/:slug/users
        │   ├── users.service.ts
        │   ├── users.module.ts
        │   └── dto/
        │       ├── create-user.dto.ts
        │       └── update-user.dto.ts
        ├── residents/
        │   ├── residents.controller.ts     # CRUD + vehicles + pets
        │   ├── residents.service.ts
        │   ├── residents.module.ts
        │   └── dto/
        │       ├── create-resident.dto.ts
        │       ├── create-vehicle.dto.ts
        │       └── create-pet.dto.ts
        ├── condominiums/
        │   ├── condominiums.controller.ts  # CRUD — /condominiums
        │   ├── condominiums.service.ts
        │   ├── condominiums.module.ts
        │   └── dto/
        │       ├── create-condominium.dto.ts
        │       └── update-condominium.dto.ts
        ├── collection/
        │   ├── collection.controller.ts    # Fee collection matrix + overrides
        │   ├── collection.service.ts
        │   └── collection.module.ts
        ├── petty-cash/
        │   ├── petty-cash.controller.ts    # Movements + approve/reject
        │   ├── petty-cash.service.ts
        │   ├── petty-cash.module.ts
        │   └── dto/
        │       └── create-movement.dto.ts
        ├── inventory/
        │   ├── inventory.controller.ts     # Common areas + inventory items
        │   ├── inventory.service.ts
        │   ├── inventory.module.ts
        │   └── dto/
        │       ├── create-common-area.dto.ts
        │       └── create-inventory-item.dto.ts
        ├── settings/
        │   ├── settings.controller.ts      # GET + 4 PATCH endpoints per settings group
        │   ├── settings.service.ts
        │   ├── settings.module.ts
        │   └── dto/
        │       ├── update-general-settings.dto.ts
        │       └── update-fees-settings.dto.ts
        ├── dashboard/
        │   ├── dashboard.controller.ts     # KPIs + 12-month trend
        │   ├── dashboard.service.ts
        │   └── dashboard.module.ts
        ├── reports/
        │   ├── reports.controller.ts       # overdue, collection-matrix, executive-summary
        │   ├── reports.service.ts
        │   └── reports.module.ts
        ├── imports/
        │   ├── imports.controller.ts       # Bank statement upload (multipart)
        │   ├── imports.service.ts
        │   └── imports.module.ts
        ├── audit/
        │   ├── audit.controller.ts         # Platform-wide (ROOT) + per-condominium logs
        │   ├── audit.service.ts
        │   └── audit.module.ts
        └── notifications/
            ├── notifications.controller.ts # List + mark read
            ├── notifications.service.ts
            └── notifications.module.ts
```

---

## 5. Environment Variables

Copy `.env.example` to `.env` and fill in real values. Never commit `.env` to version control.

| Variable | Example Value | Required | Description |
|---|---|---|---|
| `PORT` | `3001` | No (default: 3001) | Port the API listens on |
| `NODE_ENV` | `development` | No | Environment label (`development`, `staging`, `production`) |
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require&pgbouncer=true` | Yes | Pooled connection via PgBouncer — used at runtime |
| `DIRECT_URL` | `postgresql://user:pass@host/db?sslmode=require` | Yes | Direct (unpooled) connection — used only by `prisma migrate` |
| `JWT_SECRET` | `replace-with-a-secure-random-secret-minimum-32-chars` | Yes | Signs access tokens (minimum 32 characters) |
| `JWT_REFRESH_SECRET` | `replace-with-a-different-secure-random-secret-minimum-32-chars` | Yes | Signs refresh tokens (must differ from `JWT_SECRET`, minimum 32 characters) |
| `JWT_EXPIRES_IN` | `15m` | No (default: `15m`) | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | No (default: `7d`) | Refresh token lifetime |
| `CORS_ORIGIN` | `http://localhost:3000,https://app.livoclouds.com` | No | Comma-separated list of allowed CORS origins |

### File Storage (Cloudflare R2) — Optional

The import pipeline works without these variables. When configured, the `/uploads` endpoint stores the original file in R2 for audit purposes. When not configured, files are processed in-memory and discarded after SHA256 hashing — the existing behavior is unchanged.

| Variable | Example Value | Required | Description |
|---|---|---|---|
| `R2_ACCOUNT_ID` | `abc123...` | No | Cloudflare account ID (found in Cloudflare Dashboard) |
| `R2_ACCESS_KEY_ID` | `key-id...` | No | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | `secret...` | No | R2 API token secret key |
| `R2_BUCKET_NAME` | `livoclouds-files` | No | Name of the private R2 bucket |
| `R2_PUBLIC_URL` | `https://assets.domain.com` | No | Optional: custom domain for public assets only |

**Neon dual-URL requirement**: Neon (PostgreSQL serverless) requires two URLs because PgBouncer (pooled mode) is incompatible with `prisma migrate`. Use `DATABASE_URL` for the pooled connection at runtime and `DIRECT_URL` for the direct connection during migrations.

---

## 6. Quick Start

### Step 1 — Install dependencies

```bash
npm install
```

### Step 2 — Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Neon connection strings, JWT secrets, and CORS origins. Get connection strings from Neon Dashboard → Branch: **Development**.

### Step 3 — Generate Prisma client

```bash
npm run prisma:generate
```

This must be run after any change to `prisma/schema.prisma`.

### Step 4 — Run migrations

```bash
npm run prisma:migrate
```

Creates and applies the database schema in your development database.

### Step 5 — Seed the database

```bash
npm run prisma:seed
```

Creates 10 test condominiums, 23 test users across all condominiums, 50 residents, 70 common areas, 120+ inventory items, 8 petty cash movements, and 4 audit log entries. The seed is idempotent — it deletes all existing data before re-creating it. **Never run against production.**

### Step 6 — Start the API

```bash
# Development (watch mode — restarts on file changes)
npm run start:dev

# Production
npm run build && npm run start:prod
```

API is available at **http://localhost:3001**

### Step 7 — Open Swagger

Visit **http://localhost:3001/docs**

Click "Authorize" and enter a Bearer token obtained from `POST /auth/login`.

### Step 8 — Health check

```bash
curl http://localhost:3001/health
# Response: { "data": { "status": "ok" } }
```

---

## 7. Scripts

| Script | Command | Description |
|---|---|---|
| Dev server | `npm run start:dev` | Starts NestJS in watch mode — restarts automatically on file changes |
| Build | `npm run build` | Compiles TypeScript to `dist/` via `nest build` |
| Production | `npm run start:prod` | Runs compiled output from `dist/main.js` |
| Lint | `npm run lint` | Runs ESLint with auto-fix on `src/` |
| Tests | `npm test` | Runs Jest test suite |
| Prisma generate | `npm run prisma:generate` | Regenerates Prisma Client from `schema.prisma` |
| Prisma migrate (dev) | `npm run prisma:migrate` | Creates and applies a new migration in development |
| Prisma migrate (prod) | `npm run prisma:deploy` | Applies existing migrations in production without creating new ones |
| Prisma seed | `npm run prisma:seed` | Runs `prisma/seed.ts` to insert initial data |
| Prisma Studio | `npm run prisma:studio` | Opens a visual browser-based database UI at http://localhost:5555 |
| Prisma reset | `npm run prisma:reset` | Drops the database, re-applies all migrations, and re-seeds (development only) |

---

## 8. Environment Configuration

### Local / Development

This project uses Neon for all environments, including local development. Obtain connection strings from Neon Dashboard → Branch: **Development**.

```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/livoclouds?sslmode=require&pgbouncer=true&connect_timeout=15
DIRECT_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/livoclouds?sslmode=require
JWT_SECRET=local-dev-secret-at-least-32-characters-long
JWT_REFRESH_SECRET=local-dev-refresh-secret-at-least-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000
```

- Use `npm run prisma:migrate` to create and apply migrations.
- Use `npm run prisma:seed` to populate test data.
- Use `npm run start:dev` for watch mode.

> **Important**: The Neon Development branch is a sandboxed copy of the schema. Never run `prisma:seed` or `prisma:reset` against any branch other than Development.

### Staging

```env
PORT=3001
NODE_ENV=staging
DATABASE_URL=postgresql://user:password@staging-host/livoclouds_staging?sslmode=require&pgbouncer=true
DIRECT_URL=postgresql://user:password@staging-host/livoclouds_staging?sslmode=require
JWT_SECRET=<strong-staging-secret-min-32-chars>
JWT_REFRESH_SECRET=<different-strong-staging-secret-min-32-chars>
CORS_ORIGIN=https://staging.livoclouds.com
```

- Use `npm run prisma:deploy` to apply migrations (never `prisma:migrate` in staging/production).
- Run seed only once during initial setup.

### Production

```env
PORT=3001
NODE_ENV=production
DATABASE_URL=postgresql://user:password@prod-host/livoclouds?sslmode=require&pgbouncer=true&connect_timeout=15
DIRECT_URL=postgresql://user:password@prod-host/livoclouds?sslmode=require
JWT_SECRET=<strong-production-secret-min-32-chars>
JWT_REFRESH_SECRET=<different-strong-production-secret-min-32-chars>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://app.livoclouds.com
```

- Use `npm run prisma:deploy` for migrations.
- Never use `prisma:reset` or `prisma:migrate` in production.
- CORS_ORIGIN must list only trusted frontend domains.
- Store secrets in environment management tools (Vercel env vars, AWS Secrets Manager, etc.) — never in version control.
- When `NODE_ENV=production`, the app ignores `.env` files and reads only from the actual environment — set all variables on your deployment platform.

---

## 9. Prisma

### Schema location

```
prisma/schema.prisma     — Data model (16 models, 19 enums)
prisma/migrations/       — Applied migration files
prisma/seed.ts           — Seed script
```

### Commands

#### Generate Prisma Client

```bash
npm run prisma:generate
# or: npx prisma generate
```

Generates the typed Prisma Client from `schema.prisma`. Run this every time you modify the schema. The generated client lives in `node_modules/@prisma/client`.

#### Migrate (development)

```bash
npm run prisma:migrate
# or: npx prisma migrate dev
```

Creates a new migration file under `prisma/migrations/`, applies it to the development database, and regenerates the Prisma Client. Use only in local/development environments with the Neon Development branch.

#### Deploy migrations (production/staging)

```bash
npm run prisma:deploy
# or: npx prisma migrate deploy
```

Applies all pending migration files to the database without creating new ones. Safe for production — it never generates or modifies migration files.

#### Prisma Studio

```bash
npm run prisma:studio
# or: npx prisma studio
```

Opens a visual browser-based interface at `http://localhost:5555` for querying and editing database records. Development only.

#### Seed

```bash
npm run prisma:seed
# or: npx prisma db seed
```

Executes `prisma/seed.ts` using `ts-node`. Creates test condominiums, users, residents, inventory items, petty cash movements, and audit logs. See [§11 Seed & Dummy Data](#11-seed--dummy-data) for details.

#### Reset (development only)

```bash
npm run prisma:reset
# or: npx prisma migrate reset
```

Drops the entire database, re-applies all migrations from scratch, and re-runs the seed. Never use in production or staging.

### When to use `migrate dev` vs `migrate deploy`

| Situation | Command |
|---|---|
| Adding or changing a model in `schema.prisma` locally | `npm run prisma:migrate` |
| Deploying existing migrations to staging or production | `npm run prisma:deploy` |
| CI/CD pipeline applying migrations before starting the app | `npm run prisma:deploy` |

### After modifying `schema.prisma`

1. Run `npm run prisma:migrate` (creates migration + regenerates client).
2. If you only need to regenerate the client without a migration: `npm run prisma:generate`.
3. Never manually edit files in `prisma/migrations/` — this can corrupt the migration history.

### Dual-URL configuration (Neon)

Neon requires two connection strings in `.env`:

- `DATABASE_URL` — pooled via PgBouncer, used for all runtime queries (`prisma.$connect()`)
- `DIRECT_URL` — direct connection (no pooler), used exclusively by `prisma migrate`

Both are referenced in `prisma/schema.prisma` under the `datasource db` block.

---

## 10. Database & Data Model

**Database**: PostgreSQL hosted on [Neon](https://neon.tech) (serverless, connection pooling via PgBouncer).

**Schema**: `prisma/schema.prisma` — 16 models, 19 enums.

### Key Models

| Model | Description |
|---|---|
| `Condominium` | Tenant root. `slug` is unique and used in all routes. `isActive` gates access. |
| `CondominiumSettings` | 1-to-1 with `Condominium`. Stores timezone, currency, fee amounts, payment days, business hours, and contact info. |
| `User` | Platform users. Has a `role` (enum), `passwordHash`, optional `condominiumId`. Soft-deleted via `deletedAt`. Email is unique per condominium (`@@unique([condominiumId, email])`). ROOT users have `condominiumId = null` and global email uniqueness enforced at the service layer. |
| `RefreshToken` | Stores issued refresh tokens. Revoked via `revokedAt` field (token rotation). |
| `Resident` | A unit within a condominium. `unitNumber` is unique per condominium. Tracks `paymentStatus`, `debt`, `monthlyFee`. Soft-deleted via `deletedAt`. |
| `Vehicle` | Belongs to a `Resident`. Also scoped by `condominiumId` for IDOR-safe writes. |
| `Pet` | Belongs to a `Resident`. |
| `AdditionalResident` | Extra occupants under a `Resident`. |
| `CollectionRecord` | Monthly fee record per resident. Tracks payment status per month/year. Unique on `[condominiumId, residentId, year, month]`. |
| `PettyCashMovement` | Cash movement (income/expense). `folio` is unique per condominium. Status workflow: `PENDING → APPROVED / REJECTED`. |
| `CommonArea` | A shared physical space in a condominium (gym, pool, security booth, etc.). |
| `InventoryItem` | An item tracked within a `CommonArea`. Has category, condition, cost, serial number, and supplier. |
| `ImportBatch` | A bank statement file upload. Contains multiple `Transaction` records. |
| `Transaction` | A parsed line from a bank statement. Linked to an `ImportBatch`. |
| `AuditLog` | Immutable action log (user, action, module, result, timestamp). |
| `Notification` | In-app notification scoped to a user + condominium. |

### Key Enums

`UserRole`, `ResidentType`, `PaymentStatus`, `PetType`, `MovementType`, `MovementCategory`, `MovementStatus`, `DeliveryMethod`, `CommonAreaStatus`, `InventoryCategory`, `InventoryCondition`, `FlowType`, `ClassificationStatus`, `ImportStatus`, `CollectionStatus`, `UnitGeneralStatus`, `AuditResult`, `NotificationType`

### Soft deletes

`User` and `Resident` use soft deletion (`deletedAt: DateTime?`). All queries on these models must include `where: { deletedAt: null }` to exclude deleted records.

---

## 11. Seed & Dummy Data

The seed populates realistic multi-tenant development data across 10 condominiums. Run with:

```bash
npm run prisma:seed
```

**The seed is idempotent**: it deletes all existing data in FK-safe order (`deleteMany`) before re-creating everything. Safe to run multiple times — but all manual changes to the database will be reset.

> **WARNING**: Never run the seed against the production database. Verify your `DATABASE_URL` points to the Development branch before running.

### Condominiums (10)

| Slug | Name | Units | Monthly Fee |
|---|---|---|---|
| `cotoalameda` | Coto La Alameda 1511 | 50 | $2,400 MXN |
| `cotolospatos` | Coto Los Patos | 30 | $1,800 MXN |
| `cotoencinos` | Coto Los Encinos | 40 | $2,200 MXN |
| `bosquesdellago` | Residencial Bosques del Lago | 60 | $3,000 MXN |
| `cotovalledorado` | Coto Valle Dorado | 45 | $2,800 MXN |
| `vistaroble` | Residencial Vista Roble | 25 | $1,500 MXN |
| `puertadelsol` | Coto Puerta del Sol | 80 | $3,500 MXN |
| `jardinesdelvalley` | Condominio Jardines del Valle | 55 | $2,600 MXN |
| `altosdelparque` | Residencial Altos del Parque | 35 | $2,000 MXN |
| `senderosdelsbosque` | Coto Senderos del Bosque | 28 | $1,900 MXN |

Each condominium has a fully populated `CondominiumSettings` record with address, adminPhone, contactEmail, businessHours, fees, and payment days.

### Users (23 total)

- 1 ROOT user (platform-wide access, active)
- 2–3 users per condominium (TENANT_ADMIN + READ_ONLY + optional GUARD)
- 13 active, 10 inactive (`isActive: false`) — see [§13 Test Accounts](#13-test-accounts) for the complete list

### Residents (50 total) — 5 per condominium

- Unit numbers "1" through "5" (string format)
- Mix of `OWNER` (3×), `TENANT` (1×), `CO_OWNER` (1×) per condominium
- Mix of `CURRENT` (3×) and `OVERDUE` (2×) payment status per condominium
- OVERDUE residents have `debt = monthlyFee × 2`
- Parking spots: 0, 1, or 2

### Common Areas (70 total) — 7 per condominium

Common area sets alternate by condominium index:

- **Even-index condominiums** (cotoalameda, cotoencinos, cotovalledorado, puertadelsol, altosdelparque): security-focused areas — Caseta de Seguridad, Oficina de Administración, Estacionamiento de Visitas, Bodega General, Área de Contenedores, plus 2 more
- **Odd-index condominiums** (cotolospatos, bosquesdellago, vistaroble, jardinesdelvalley, senderosdelsbosque): amenities-focused areas — Salón de Eventos, Alberca, Gimnasio, Jardines Comunes, Área de Asadores, plus 2 more

### Inventory Items (120 total) — 12 per condominium

Items follow the same security/amenities split as common areas:

- **Security-type**: IP cameras, Motorola radios, access control panels, laptops, printers, traffic signs, cones, lawn mowers, fire extinguishers, pressure washers, UPS units
- **Amenities-type**: professional sound systems, folding tables, folding chairs, pool pumps, pool cleaning robots, treadmills, exercise bikes, dumbbells, garden benches, solar LED lights, gas grills, CO₂ extinguishers

All items have: `brand`, `model`, `serialNumber`, `approximateCost`, `supplier`, `purchaseDate`, `condition`, `hasInvoice`, and `notes` populated.

### Petty Cash (8 movements) — first 3 condominiums only

- `cotoalameda`: 3 movements (APPROVED opening balance ENTRY, APPROVED cleaning EXIT, PENDING maintenance EXIT)
- `cotolospatos`: 2 movements (APPROVED opening balance ENTRY, APPROVED gardening EXIT)
- `cotoencinos`: 3 movements (APPROVED opening balance ENTRY, APPROVED stationery EXIT, REJECTED services EXIT)

### Audit Logs (4 entries) — cotoalameda only

Four log entries covering: user login, settings update, resident creation, and root user login.

---

## 12. Authentication & Authorization

### Token flow

1. Client sends `POST /auth/login` with `{ email, password }`.
2. API returns `{ accessToken, refreshToken, user }`.
3. Client uses `Authorization: Bearer <accessToken>` on all protected requests.
4. When the access token expires, client sends `POST /auth/refresh` with `{ refreshToken }`.
5. API returns a new `{ accessToken, refreshToken }` pair and revokes the old refresh token.
6. On logout, client sends `POST /auth/logout`; the refresh token is revoked in the database.

### Token details

| Token | Lifetime | Storage |
|---|---|---|
| Access token | 15 minutes (configurable via `JWT_EXPIRES_IN`) | Client-side only |
| Refresh token | 7 days (configurable via `JWT_REFRESH_EXPIRES_IN`) | Client-side + stored in `RefreshToken` DB table |

Refresh tokens are revoked by setting `revokedAt` in the database. A token is invalid if `revokedAt` is set or if it has expired.

### Sending the token

```
Authorization: Bearer <accessToken>
```

### JwtPayload shape

```ts
{
  sub: string;              // User ID
  email: string;
  role: UserRole;
  condominiumId: string | null;
  condominiumSlug: string | null;
  iat?: number;             // Issued at (Unix timestamp)
  exp?: number;             // Expiry (Unix timestamp)
}
```

### Roles

| Role | Description |
|---|---|
| `ROOT` | Platform super-admin. Access to all condominiums and platform-level resources. Bypasses tenant isolation. |
| `TENANT_ADMIN` | Condominium admin. Full access within their own condominium. |
| `READ_ONLY` | Read access only within their condominium. |
| `GUARD` | Security guard role. Limited write access on specific endpoints. |
| `NEIGHBOR` | Resident/owner user. Restricted access to own data. |

### Guards and decorators

| Guard / Decorator | Purpose |
|---|---|
| `JwtAuthGuard` | Applied globally. Validates Bearer JWT on all requests. |
| `@Public()` | Decorator that bypasses `JwtAuthGuard` for a specific endpoint. |
| `RolesGuard` | Applied per-controller. Checks that the user's role matches `@Roles(...)`. |
| `@Roles(...UserRole)` | Decorator that specifies which roles may access an endpoint. |
| `CondominiumAccessGuard` | Applied per-controller. Extracts `:condominiumSlug` from the URL, validates the condominium exists and is active, and sets `request.condominiumId`. ROOT users bypass the ownership check. |
| `@CurrentUser()` | Parameter decorator that injects the decoded `JwtPayload` into the handler. |

### Request pipeline (applied globally)

```
Incoming request
  → GlobalExceptionFilter      (catches and normalizes errors)
  → JwtAuthGuard               (validates JWT; skipped if @Public())
  → RolesGuard                 (checks @Roles metadata)
  → CondominiumAccessGuard     (multi-tenant isolation)
  → Controller handler
  → ResponseInterceptor        (wraps success in { data: T })
```

---

## 13. Test Accounts

Created by `prisma/seed.ts`. Use these credentials for local development and testing.

Inactive accounts (`isActive: false`) cannot log in — they exist to test the inactive-state behavior.

| Email | Password | Role | Condominium | Active |
|---|---|---|---|---|
| `root@demo.com` | `Root1234!` | `ROOT` | All | Yes |
| `admin@cotoalameda.com` | `Admin1234!` | `TENANT_ADMIN` | `cotoalameda` | Yes |
| `view@cotoalameda.com` | `View1234!` | `READ_ONLY` | `cotoalameda` | Yes |
| `guard@cotoalameda.com` | `Guard1234!` | `GUARD` | `cotoalameda` | **No** |
| `admin@cotolospatos.com` | `Admin1234!` | `TENANT_ADMIN` | `cotolospatos` | Yes |
| `view@cotolospatos.com` | `View1234!` | `READ_ONLY` | `cotolospatos` | **No** |
| `admin@cotoencinos.com` | `Admin1234!` | `TENANT_ADMIN` | `cotoencinos` | Yes |
| `view@cotoencinos.com` | `View1234!` | `READ_ONLY` | `cotoencinos` | **No** |
| `admin@bosquesdellago.com` | `Admin1234!` | `TENANT_ADMIN` | `bosquesdellago` | Yes |
| `guard@bosquesdellago.com` | `Guard1234!` | `GUARD` | `bosquesdellago` | **No** |
| `admin@cotovalledorado.com` | `Admin1234!` | `TENANT_ADMIN` | `cotovalledorado` | **No** |
| `view@cotovalledorado.com` | `View1234!` | `READ_ONLY` | `cotovalledorado` | Yes |
| `admin@vistaroble.com` | `Admin1234!` | `TENANT_ADMIN` | `vistaroble` | Yes |
| `view@vistaroble.com` | `View1234!` | `READ_ONLY` | `vistaroble` | **No** |
| `admin@puertadelsol.com` | `Admin1234!` | `TENANT_ADMIN` | `puertadelsol` | **No** |
| `guard@puertadelsol.com` | `Guard1234!` | `GUARD` | `puertadelsol` | Yes |
| `admin@jardinesdelvalley.com` | `Admin1234!` | `TENANT_ADMIN` | `jardinesdelvalley` | Yes |
| `view@jardinesdelvalley.com` | `View1234!` | `READ_ONLY` | `jardinesdelvalley` | **No** |
| `guard@jardinesdelvalley.com` | `Guard1234!` | `GUARD` | `jardinesdelvalley` | Yes |
| `admin@altosdelparque.com` | `Admin1234!` | `TENANT_ADMIN` | `altosdelparque` | Yes |
| `view@altosdelparque.com` | `View1234!` | `READ_ONLY` | `altosdelparque` | **No** |
| `admin@senderosdelsbosque.com` | `Admin1234!` | `TENANT_ADMIN` | `senderosdelsbosque` | **No** |
| `view@senderosdelsbosque.com` | `View1234!` | `READ_ONLY` | `senderosdelsbosque` | Yes |

---

## 14. API Endpoints

All protected endpoints require `Authorization: Bearer <accessToken>`. Public endpoints are marked explicitly.

Base URL: `http://localhost:3001`

Full interactive documentation: `http://localhost:3001/docs`

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Health check — returns `{ status: "ok" }` |

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Login with email + password. Returns access and refresh tokens. |
| `POST` | `/auth/refresh` | Public | Rotate refresh token. Returns new token pair, revokes the old refresh token. |
| `POST` | `/auth/logout` | JWT | Revoke the current refresh token. |
| `GET` | `/auth/me` | JWT | Return the currently authenticated user's profile. |

### Condominiums

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums` | JWT | Any | List all condominiums. |
| `GET` | `/condominiums/:slug` | JWT | Any | Get condominium by slug. |
| `POST` | `/condominiums` | JWT | ROOT | Create a new condominium. |
| `PATCH` | `/condominiums/:id` | JWT | ROOT, TENANT_ADMIN | Update condominium fields. |
| `DELETE` | `/condominiums/:id` | JWT | ROOT | Deactivate a condominium (`isActive = false`). |

### Users

All routes are scoped to `/condominiums/:condominiumSlug/users`.

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/users` | JWT | ROOT, TENANT_ADMIN | List users in the condominium. |
| `GET` | `/condominiums/:condominiumSlug/users/:id` | JWT | ROOT, TENANT_ADMIN | Get a user by ID. |
| `POST` | `/condominiums/:condominiumSlug/users` | JWT | ROOT, TENANT_ADMIN | Create a user in the condominium. |
| `PATCH` | `/condominiums/:condominiumSlug/users/:id` | JWT | ROOT, TENANT_ADMIN | Update a user. |
| `DELETE` | `/condominiums/:condominiumSlug/users/:id` | JWT | ROOT, TENANT_ADMIN | Soft-delete a user (`deletedAt = now()`). |

### Residents

All routes are scoped to `/condominiums/:condominiumSlug/residents`.

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/residents` | JWT | Any | List residents. |
| `GET` | `/condominiums/:condominiumSlug/residents/:id` | JWT | Any | Get resident profile with vehicles and pets. |
| `POST` | `/condominiums/:condominiumSlug/residents` | JWT | ROOT, TENANT_ADMIN | Create a resident. |
| `PATCH` | `/condominiums/:condominiumSlug/residents/:id` | JWT | ROOT, TENANT_ADMIN | Update a resident. |
| `DELETE` | `/condominiums/:condominiumSlug/residents/:id` | JWT | ROOT, TENANT_ADMIN | Soft-delete a resident. |
| `POST` | `/condominiums/:condominiumSlug/residents/:id/vehicles` | JWT | ROOT, TENANT_ADMIN | Add a vehicle to a resident. |
| `PATCH` | `/condominiums/:condominiumSlug/residents/:id/vehicles/:vehicleId` | JWT | ROOT, TENANT_ADMIN | Update a vehicle. |
| `DELETE` | `/condominiums/:condominiumSlug/residents/:id/vehicles/:vehicleId` | JWT | ROOT, TENANT_ADMIN | Remove a vehicle. |
| `POST` | `/condominiums/:condominiumSlug/residents/:id/pets` | JWT | ROOT, TENANT_ADMIN | Add a pet to a resident. |
| `PATCH` | `/condominiums/:condominiumSlug/residents/:id/pets/:petId` | JWT | ROOT, TENANT_ADMIN | Update a pet. |
| `DELETE` | `/condominiums/:condominiumSlug/residents/:id/pets/:petId` | JWT | ROOT, TENANT_ADMIN | Remove a pet. |

### Collection

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/collection` | JWT | Any | Collection matrix for the year (query: `year`). |
| `GET` | `/condominiums/:condominiumSlug/collection/residents/:residentId` | JWT | Any | Fee collection history for a specific resident. |
| `PATCH` | `/condominiums/:condominiumSlug/collection/:id` | JWT | ROOT, TENANT_ADMIN | Manual override of a collection record. |

### Petty Cash

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/petty-cash` | JWT | Any | List petty cash movements. |
| `GET` | `/condominiums/:condominiumSlug/petty-cash/:id` | JWT | Any | Get movement by ID. |
| `POST` | `/condominiums/:condominiumSlug/petty-cash` | JWT | ROOT, TENANT_ADMIN | Create a petty cash movement (status: PENDING). |
| `POST` | `/condominiums/:condominiumSlug/petty-cash/:id/approve` | JWT | ROOT, TENANT_ADMIN | Approve a PENDING movement. |
| `POST` | `/condominiums/:condominiumSlug/petty-cash/:id/reject` | JWT | ROOT, TENANT_ADMIN | Reject a PENDING movement. |

### Inventory — Common Areas

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/common-areas` | JWT | Any | List common areas. |
| `POST` | `/condominiums/:condominiumSlug/common-areas` | JWT | ROOT, TENANT_ADMIN | Create a common area. |
| `PATCH` | `/condominiums/:condominiumSlug/common-areas/:id` | JWT | ROOT, TENANT_ADMIN | Update a common area. |
| `DELETE` | `/condominiums/:condominiumSlug/common-areas/:id` | JWT | ROOT, TENANT_ADMIN | Delete a common area. |

### Inventory — Items

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/inventory` | JWT | Any | List inventory items. |
| `POST` | `/condominiums/:condominiumSlug/inventory` | JWT | ROOT, TENANT_ADMIN | Create an inventory item. |
| `PATCH` | `/condominiums/:condominiumSlug/inventory/:id` | JWT | ROOT, TENANT_ADMIN | Update an inventory item. |
| `DELETE` | `/condominiums/:condominiumSlug/inventory/:id` | JWT | ROOT, TENANT_ADMIN | Delete an inventory item. |

### Settings

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/settings` | JWT | Any | Get all settings for the condominium. |
| `PATCH` | `/condominiums/:condominiumSlug/settings/general` | JWT | ROOT, TENANT_ADMIN | Update general settings (name, logo, timezone, address). |
| `PATCH` | `/condominiums/:condominiumSlug/settings/fees` | JWT | ROOT, TENANT_ADMIN | Update fee settings (amounts, payment days). |
| `PATCH` | `/condominiums/:condominiumSlug/settings/financial` | JWT | ROOT, TENANT_ADMIN | Update financial/import settings. |
| `PATCH` | `/condominiums/:condominiumSlug/settings/notifications` | JWT | ROOT, TENANT_ADMIN | Update notification preferences. |

### Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/dashboard` | JWT | KPI summary (query: `year`, `month`). |
| `GET` | `/condominiums/:condominiumSlug/dashboard/trend` | JWT | 12-month trend data (query: `year`). |

### Reports

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/reports/overdue` | JWT | Report of residents with overdue payments. |
| `GET` | `/condominiums/:condominiumSlug/reports/collection-matrix` | JWT | Annual collection matrix (query: `year`). |
| `GET` | `/condominiums/:condominiumSlug/reports/executive-summary` | JWT | Executive summary report (query: `year`, `month`). |

### Imports

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/imports` | JWT | Any | List import batches. |
| `GET` | `/condominiums/:condominiumSlug/imports/:id` | JWT | Any | Get import batch with all its transactions. |
| `POST` | `/condominiums/:condominiumSlug/imports/upload` | JWT | ROOT, TENANT_ADMIN | Upload bank statement files (multipart, max 5 files, 20 MB each). Hashes each file; if external storage is configured, stores the original file in R2/S3. |
| `POST` | `/condominiums/:condominiumSlug/imports/confirm` | JWT | ROOT, TENANT_ADMIN | Persist parsed transaction data. Receives pre-parsed transactions (sent by the web app after local file parsing), creates a completed `ImportBatch`, and batch-inserts `Transaction` records. |
| `DELETE` | `/condominiums/:condominiumSlug/imports/:id` | JWT | ROOT, TENANT_ADMIN | Cancel and delete an import batch. |

### Audit

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/audit` | JWT | ROOT | Platform-wide audit logs (all condominiums). |
| `GET` | `/condominiums/:condominiumSlug/audit` | JWT | Any | Audit logs for a specific condominium. |

### Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/condominiums/:condominiumSlug/notifications` | JWT | List notifications for the current user. |
| `POST` | `/condominiums/:condominiumSlug/notifications/:id/read` | JWT | Mark a notification as read. |
| `POST` | `/condominiums/:condominiumSlug/notifications/read-all` | JWT | Mark all notifications as read. |

---

## 15. Response Format

All responses go through the global `ResponseInterceptor` (success) or `GlobalExceptionFilter` (errors).

### Success

```json
{
  "data": { }
}
```

The `data` field contains the payload — an object, array, or scalar depending on the endpoint.

### Error

```json
{
  "errors": [
    {
      "code": "NOT_FOUND",
      "reason": "Resident with ID abc123 not found",
      "datetime": "2026-05-09T12:00:00.000Z",
      "path": "/condominiums/cotoalameda/residents/abc123"
    }
  ]
}
```

| Field | Description |
|---|---|
| `code` | HTTP status name (e.g. `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE_ENTITY`, `INTERNAL_SERVER_ERROR`) |
| `reason` | Human-readable explanation of the error |
| `datetime` | ISO 8601 timestamp when the error occurred |
| `path` | The request path that triggered the error |

### HTTP status code mapping

| NestJS Exception | HTTP Status | `code` |
|---|---|---|
| `UnauthorizedException` | 401 | `UNAUTHORIZED` |
| `ForbiddenException` | 403 | `FORBIDDEN` |
| `NotFoundException` | 404 | `NOT_FOUND` |
| `ConflictException` | 409 | `CONFLICT` |
| `BadRequestException` | 400 | `BAD_REQUEST` |
| `UnprocessableEntityException` | 422 | `UNPROCESSABLE_ENTITY` |
| `InternalServerErrorException` | 500 | `INTERNAL_SERVER_ERROR` |

---

## 16. Error Handling

Error handling is centralized in `src/common/filters/http-exception.filter.ts` (the `GlobalExceptionFilter`), registered globally in `app.module.ts` as `APP_FILTER`.

**Validation errors** are produced by NestJS's `ValidationPipe` (configured globally in `main.ts`) using class-validator decorators on DTOs. The pipe is configured with:

```ts
{
  whitelist: true,             // strips unknown properties from the request body
  forbidNonWhitelisted: true,  // throws 400 if unknown properties are sent
  transform: true,             // automatically transforms plain objects to DTO class instances
}
```

Validation failures return HTTP 400 with a `BAD_REQUEST` code. The `reason` field contains the validation error messages.

**Service-level errors** are thrown using NestJS exception classes (`NotFoundException`, `ConflictException`, etc.), which are caught and normalized by the global filter.

**Unhandled exceptions** (programming errors) are caught and returned as `INTERNAL_SERVER_ERROR` (500) without exposing internal details.

---

## 17. Web Integration Guide

This section documents how the frontend application must consume this API. It is intended for developers and AI agents working on the web frontend.

### Configure the API base URL

The frontend must never hardcode the API URL. Use an environment variable:

```env
# .env.local (Next.js) or equivalent
NEXT_PUBLIC_API_URL=http://localhost:3001
```

In production, set this to the deployed API URL via your hosting platform (Vercel, Railway, etc.). The web application must never hardcode `http://localhost:3001` in production code.

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "admin@cotoalameda.com",
  "password": "Admin1234!"
}
```

Successful response:

```json
{
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>",
    "user": {
      "id": "<uuid>",
      "email": "admin@cotoalameda.com",
      "firstName": "Carlos",
      "lastName": "Mendoza",
      "role": "TENANT_ADMIN",
      "condominiumId": "<uuid>",
      "condominiumSlug": "cotoalameda",
      "avatarUrl": null
    }
  }
}
```

After login, store:
- `accessToken` — used in the `Authorization` header for every protected request
- `refreshToken` — used to obtain a new access token when the current one expires
- The full `user` object — `condominiumSlug` is required to build all tenant-scoped URLs

Do not store `passwordHash` or other sensitive fields. The login response does not include them.

### Making authenticated requests

Include the access token in every protected request:

```http
GET /condominiums/cotoalameda/residents
Authorization: Bearer <accessToken>
```

Build tenant-scoped URLs dynamically using the stored `user.condominiumSlug`:

```ts
const url = `${process.env.NEXT_PUBLIC_API_URL}/condominiums/${user.condominiumSlug}/residents`;
```

Do not hardcode the slug. Read it from the stored user object after login.

### Refreshing the access token

The access token expires after 15 minutes (configurable). When the API returns HTTP 401, attempt a token refresh before redirecting to login:

```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "<storedRefreshToken>"
}
```

On success, replace the stored tokens with the new pair returned in `data`, then retry the failed request. On failure (refresh token expired or revoked), clear all stored tokens and redirect to the login page.

### Logout

```http
POST /auth/logout
Authorization: Bearer <accessToken>
```

On success (or on any error during logout), clear all stored tokens and the `user` object from client storage, then redirect to login.

### Validating the session on app load

Use `GET /auth/me` to validate whether the stored token is still valid when the application initializes:

```http
GET /auth/me
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "data": {
    "id": "<uuid>",
    "email": "admin@cotoalameda.com",
    "firstName": "Carlos",
    "lastName": "Mendoza",
    "role": "TENANT_ADMIN",
    "avatarUrl": null,
    "condominium": {
      "id": "<uuid>",
      "slug": "cotoalameda",
      "name": "Coto La Alameda 1511"
    }
  }
}
```

If this returns 401, the session is expired — redirect to login.

### Handling errors

| HTTP Status | `errors[0].code` | Frontend action |
|---|---|---|
| 400 | `BAD_REQUEST` | Display `errors[0].reason` as a form or field error |
| 401 | `UNAUTHORIZED` | Attempt token refresh; if refresh fails, redirect to login |
| 403 | `FORBIDDEN` | Show "access denied" — user lacks the required role |
| 404 | `NOT_FOUND` | Show empty state or "not found" message |
| 409 | `CONFLICT` | Display `errors[0].reason` — typically a duplicate value |
| 422 | `UNPROCESSABLE_ENTITY` | Display `errors[0].reason` |
| 500 | `INTERNAL_SERVER_ERROR` | Show a generic error message; do not display the raw `reason` to users |

All error responses follow the same structure — always read from `errors[0].reason` for display.

### API discovery

Full interactive documentation is available at `http://localhost:3001/docs` (development only). In Swagger, click "Authorize" and enter the Bearer token from `POST /auth/login`.

---

## 18. Frontend/Backend Contract

### The frontend must

- Send `Authorization: Bearer <accessToken>` on every protected request
- Use `user.condominiumSlug` (from the stored login response) to build all tenant-scoped URLs
- Handle HTTP 401 by attempting a token refresh before redirecting to login
- Handle HTTP 403 by showing an "access denied" message — never attempt to bypass role restrictions
- Display validation errors from `errors[0].reason` on HTTP 400
- Use environment variables for the API base URL — never hardcode it
- Store only `accessToken`, `refreshToken`, and the `user` object after login
- Clear all stored tokens and user data on logout

### The frontend must not

- Decide or set the `condominiumId` manually
- Send `condominiumId` in request bodies as a source of authorization — the API ignores and rejects this pattern
- Filter data by tenant on the client side — all tenant filtering happens at the API level
- Hardcode condominium slugs, condominium IDs, or user IDs
- Assume access to data from a condominium other than the one in the authenticated user's token
- Store raw tokens in locations accessible to third-party scripts (e.g. unsanitized `localStorage` in XSS-vulnerable contexts)
- Expose tokens in logs, analytics payloads, or error reporting tools

### The API guarantees

- JWT validation on every protected request
- Resolution of `condominiumId` from the guard — not from the request body
- Filtering all Prisma queries by `condominiumId`
- Role validation before any write operation
- IDOR-safe writes using `{ id, condominiumId }` in `where` clauses
- Rejection of any cross-tenant access attempt with HTTP 403
- Consistent response structure (`{ data: T }` for success, `{ errors: [...] }` for errors)

---

## 19. Conventions for New Endpoints

Every new endpoint added to this API must follow these conventions.

### Tenant-scoped controllers

Apply both guards:

```ts
@UseGuards(CondominiumAccessGuard, RolesGuard)
```

Never apply only one — both are required for tenant isolation and role enforcement.

### Resolving `condominiumId`

Get `condominiumId` from the request object set by `CondominiumAccessGuard`:

```ts
// In a controller method:
async create(@Req() req: FastifyRequest & { condominiumId: string }) {
  return this.myService.create(req.condominiumId, ...);
}
```

Never read `condominiumId` from the request body, query params, or URL params — always use the guard-resolved value from `req.condominiumId`.

### Read queries

For models without soft delete:

```ts
prisma.inventoryItem.findMany({ where: { condominiumId } })
```

For models with soft delete (`User`, `Resident`):

```ts
prisma.resident.findMany({ where: { condominiumId, deletedAt: null } })
```

### Write queries (IDOR-safe)

Use `updateMany` or `deleteMany` with both `id` and `condominiumId` in the `where` clause:

```ts
const result = await prisma.inventoryItem.updateMany({
  where: { id, condominiumId },
  data: { ... },
});
if (result.count === 0) throw new NotFoundException('Item not found');
```

This prevents a user from updating a record that belongs to another condominium, even if they guess the ID.

### DTOs

Every input DTO must have:
- `class-validator` decorators on every field (`@IsString()`, `@IsEmail()`, `@IsEnum()`, etc.)
- `@ApiProperty()` for Swagger documentation
- No extra properties — the `ValidationPipe` whitelist will strip them

### Errors

Throw NestJS exception classes — never return error objects from controller methods:

```ts
throw new NotFoundException('Resource not found');
throw new ConflictException('Email already exists in this condominium');
throw new ForbiddenException('Insufficient permissions');
```

Never include internal details (stack traces, foreign IDs, raw DB errors) in exception messages.

---

## 20. Web & Mobile Considerations

### Bearer Token — no cookies required

This API uses Bearer Token authentication exclusively. It does not set cookies or depend on browser session state. This makes it compatible with:

- Web applications (store tokens in `localStorage`, `sessionStorage`, or in-memory state)
- Mobile applications (store tokens in secure storage — iOS Keychain, Android Keystore)
- Any HTTP client that can set the `Authorization` header

### Future mobile client

A future mobile app (e.g. React Native) can consume this API using the exact same authentication flow as the web. No API-specific changes are required for mobile compatibility — the existing endpoints, JWT format, and error responses are already mobile-ready.

### Endpoint compatibility

Do not add endpoints that are exclusively web-specific (e.g. relying on cookies, CSRF tokens, or browser-only behavior). All new endpoints must be consumable by any HTTP client.

### CORS for local mobile development

If a React Native development server runs on `http://localhost:8081`, add it to `CORS_ORIGIN` in the local `.env`:

```env
CORS_ORIGIN=http://localhost:3000,http://localhost:8081
```

Do not add mobile development origins to the production CORS config.

---

## 21. Security

### Secrets and credentials

- Never commit `.env` to version control — it is listed in `.gitignore`.
- Never hardcode connection strings, JWT secrets, or API keys in source code.
- Generate JWT secrets with: `node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"`
- Store production secrets in the deployment platform's environment management (Vercel env vars, AWS Secrets Manager, etc.).

### Database safety

- Never run `npm run prisma:seed` or `npm run prisma:reset` against a production or staging database.
- Verify your `DATABASE_URL` points to the Development branch before running destructive commands.
- Use `npm run prisma:deploy` (not `prisma:migrate`) in production — it only applies existing migrations.

### Tenant isolation

- Never trust `condominiumId` sent by the client in a request body or query param.
- Always use `req.condominiumId` (set by `CondominiumAccessGuard`) as the authoritative tenant context.
- Use `{ id, condominiumId }` in write query `where` clauses to prevent IDOR attacks.
- Validate tenant membership before any write operation — even for ROOT users performing tenant-scoped actions.

### Passwords

- Passwords are hashed with bcrypt at 12 salt rounds before storage.
- Never expose `passwordHash` in any API response. Use the `safeSelect()` pattern in services.
- Never log passwords or password hashes anywhere in the application.

### CORS

- Restrict `CORS_ORIGIN` to known, trusted frontend domains in production.
- Do not use wildcard origins (`*`) in production.

### Error responses

- Do not reveal internal details (stack traces, foreign resource IDs, raw Prisma errors) in error messages.
- Return generic `INTERNAL_SERVER_ERROR` messages for unhandled exceptions.

---

## 22. Docker

### Dockerfile

The Dockerfile uses a two-stage build:

1. **Builder stage**: Node 22 Alpine, installs all dependencies, generates Prisma Client, compiles TypeScript to `dist/`.
2. **Runner stage**: Copies only production dependencies and `dist/` — no dev tools, smaller image size.

The container exposes port 3001 and runs `node dist/main`.

### docker-compose.yml

```yaml
# Single service: api
# Maps port 3001 → 3001
# Loads env from .env
# Restart policy: unless-stopped
```

### Build and run

```bash
# Build image
docker build -t livoclouds-api .

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop
docker-compose down
```

Note: The database is hosted on Neon and is not included in `docker-compose.yml`. Ensure `DATABASE_URL` and `DIRECT_URL` in `.env` point to a reachable Neon instance before starting the container.

---

## 23. Onboarding Flow

Follow this sequence when joining the project or starting a new session.

1. **Read this README** — understand the overall architecture, stack, and conventions.
2. **Check `.env.example`** — copy to `.env` and fill in all required values using the Neon Development branch connection strings.
3. **Review `package.json`** — understand available scripts and all direct dependencies.
4. **Read `prisma/schema.prisma`** — understand the full data model (models, enums, relations).
5. **Read `src/app.module.ts`** — understand which modules are registered and what global providers are applied.
6. **Read `src/main.ts`** — understand bootstrap config (Fastify, CORS, ValidationPipe, Swagger, port).
7. **Explore `src/common/`** — understand guards, filters, interceptors, decorators, and shared types.
8. **Browse `src/modules/`** — explore the 13 feature modules: controller → service → DTO.
9. **Read `CLAUDE.md`** — AI-specific technical reference with additional patterns and conventions.
10. **Run the seed and start dev server** — validate that the local setup works end to end.

---

## 24. Project Conventions

### Architecture

- **No repository layer** — services inject `PrismaService` directly and query the database without intermediate repository classes.
- **Feature modules** — each module is self-contained (`module.ts`, `controller.ts`, `service.ts`, `dto/`).
- **Global providers** — `GlobalExceptionFilter`, `JwtAuthGuard`, and `ResponseInterceptor` are registered once in `app.module.ts`.

### Data access

- **`safeSelect()`** — a private method pattern used in services to exclude `passwordHash` from User responses. Never expose `passwordHash` in any response.
- **Soft deletes** — `User` and `Resident` use `deletedAt`. Always include `where: { deletedAt: null }` when querying these models.
- **Tenant isolation** — all service methods receive `condominiumId` and filter by it at the query level.

### Configuration

- All config files use `registerAs('key', () => ({ ... }))` from `@nestjs/config`.
- `ConfigModule` is global — inject `ConfigService` anywhere.

### DTOs

- Every input DTO uses class-validator decorators (`@IsString()`, `@IsEmail()`, etc.) and `@ApiProperty()` for Swagger.
- ValidationPipe enforces whitelist — DTOs define exactly which fields are accepted.

### Routes

- Tenant-scoped route prefix: `/condominiums/:condominiumSlug/[resource]`
- Platform-level routes (ROOT only) have no condominium prefix.

### Security

- Never hardcode secrets in source code. Always use environment variables.
- Secrets are loaded via `ConfigService` from the config files in `src/config/`.
- CORS must be restricted to known frontend origins in all non-local environments.
- Passwords are hashed with bcrypt (12 salt rounds) before storage.

---

## 25. Known Gaps

The following are known limitations that have not been implemented yet:

| Gap | Description |
|---|---|
| No HTTP security headers | Helmet is not configured. Headers like `X-Content-Type-Options`, `X-Frame-Options`, and CSP are absent. |
| No rate limiting | There is no throttling guard or rate limiting middleware. |
| No dedicated logging library | Logging relies on NestJS's built-in `Logger` and Fastify's logger. No structured log aggregation. |
| No test files | Jest is fully configured but no test specs have been written. `npm test` will pass with zero test files. |
| Inconsistent pagination | `PaginationQuery` type is defined in `src/common/types/index.ts` but not consistently applied across all list endpoints. |
| No external file storage configured | The `StorageService` and R2 integration are implemented but inactive until `R2_*` environment variables are set. Without them, uploaded files are hashed and discarded — original files are not retained. See Section 5 for setup instructions. |

---

## 26. Troubleshooting

### Port already in use

```
Error: listen EADDRINUSE: address already in use 0.0.0.0:3001
```

Find and kill the process using port 3001:

```bash
# Find the PID
lsof -i :3001

# Kill it
kill -9 <PID>

# Or in one command
lsof -ti :3001 | xargs kill -9
```

Alternatively, change the port in `.env`: `PORT=3002`

### Prisma Client not generated

```
Error: Cannot find module '@prisma/client'
```

Run:

```bash
npm run prisma:generate
```

This happens when the client has not been generated yet, or after pulling changes that modified `prisma/schema.prisma`.

### Missing environment variables

```
Error: Configuration key "jwt.secret" does not exist
```

Compare your `.env` with `.env.example` and ensure all required variables are defined.

### Pending migrations

```
Error: The database schema is not in sync with the Prisma schema
```

Run:

```bash
npm run prisma:migrate   # development
# or
npm run prisma:deploy    # production/staging
```

### Invalid JWT

```json
{ "errors": [{ "code": "UNAUTHORIZED", "reason": "Unauthorized" }] }
```

- Ensure the token is included as `Authorization: Bearer <token>`.
- Ensure the access token has not expired (default: 15 minutes).
- Ensure `JWT_SECRET` in `.env` matches the secret used when the token was issued.
- If the token was issued with a different secret, re-login to get a new one.

### Database connection failure

```
Error: Can't reach database server at ...
```

- Verify `DATABASE_URL` is correctly formatted and the Neon host is reachable.
- Ensure `sslmode=require` is included for Neon connections.
- For migrations, verify `DIRECT_URL` is the unpooled connection (no `pgbouncer=true`).

### Unique constraint violation

```
Error: Unique constraint failed on the fields: (`condominiumId`, `email`)
```

Common causes:
- Duplicate `email` within the same condominium on `User` — email must be unique per condominium
- Duplicate `slug` on `Condominium`
- Duplicate `unitNumber` within the same condominium on `Resident`
- Duplicate `folio` within the same condominium on `PettyCashMovement`

The seed is idempotent — it deletes all existing data first using `deleteMany` in FK order, then re-creates everything. Running `npm run prisma:seed` more than once is safe, but **all data will be reset** to the initial seed state.

### Seed executed against wrong database

Before running the seed, verify your `DATABASE_URL` points to the Development branch and not production:

```bash
npx prisma db execute --stdin <<< "SELECT current_database();"
```

The output should show the development database name, not a production one.

### Data not visible / wrong tenant

If requests return empty results or 403:

- Confirm that the `:condominiumSlug` in the URL matches the authenticated user's `condominiumSlug` from their JWT payload.
- Re-login and check `user.condominiumSlug` in the login response.
- ROOT users can access any condominium — other roles can only access their own.

### 403 Forbidden on admin endpoint

```json
{ "errors": [{ "code": "FORBIDDEN", "reason": "Forbidden resource" }] }
```

- Verify the user's `role` is `TENANT_ADMIN` or `ROOT` for write operations.
- `READ_ONLY`, `GUARD`, and `NEIGHBOR` roles cannot perform write operations on most endpoints.
- Check that the user's `isActive` is `true` — inactive users cannot authenticate.

### TypeScript compilation errors

```
error TS2307: Cannot find module '@/*'
```

Ensure the `@/*` path alias is configured in `tsconfig.json` and that you ran `npm install`.

---

## 27. Notes for AI Assistants

If you are an AI assistant or code tool working in this repository, read the following before making any changes.

### Before modifying any file

1. Read this README in full.
2. Read `CLAUDE.md` — it contains technical patterns and conventions specific to this codebase.
3. Read the relevant module's `controller.ts`, `service.ts`, and `dto/` files before editing them.
4. Read `prisma/schema.prisma` if any database model or field is involved.

### File and symbol hygiene

- Do not assume file paths, module names, or function names exist — verify them before referencing.
- Do not delete or rename any export, class, or function without first tracing all usages in the codebase.
- Do not generate new migration files manually — use `npm run prisma:migrate`.
- Do not modify files in `prisma/migrations/` — these are append-only and managed by Prisma.

### Code quality

- This project uses TypeScript strict mode (`noImplicitAny`, `strictNullChecks`). All code must compile without errors.
- Never use `any` without a justified comment.
- Do not add `// eslint-disable` unless absolutely necessary.
- Preserve the NestJS module structure — do not flatten modules or add files outside the established pattern.

### Request pipeline

The global pipeline order in `app.module.ts` is:

```
APP_FILTER (GlobalExceptionFilter) → APP_GUARD (JwtAuthGuard) → APP_INTERCEPTOR (ResponseInterceptor)
```

Do not change this order without understanding the implications on all endpoints.

### Validation

- Do not add validation logic inside controllers or services for data that is already validated by DTOs + ValidationPipe.
- Do not remove `whitelist: true` or `forbidNonWhitelisted: true` from the ValidationPipe.

### After making changes

- Run `npm run lint` to check for ESLint errors.
- Run `npm test` to run the test suite (currently 0 specs — this will pass until tests are written).
- If `prisma/schema.prisma` was modified, run `npm run prisma:generate`.
- Verify that the API starts cleanly with `npm run start:dev` before considering a task complete.

---

### Web Integration Checklist

Use this checklist when modifying the web frontend to consume this API.

```
□ Set API base URL via environment variable (e.g. NEXT_PUBLIC_API_URL=http://localhost:3001)
  — never hardcode the URL in application code

□ POST /auth/login → store accessToken, refreshToken, and the full user object
  — response is wrapped: read from response.data.accessToken, response.data.user, etc.

□ Read user.condominiumSlug from the stored user object
  — use it to build all tenant-scoped API URLs dynamically

□ Send Authorization: Bearer <accessToken> on every protected request
  — all endpoints except /health, /auth/login, /auth/refresh are protected

□ Implement token refresh: POST /auth/refresh when the API returns HTTP 401
  — on refresh success: update stored tokens and retry the failed request
  — on refresh failure: clear all tokens and redirect to login

□ On logout: POST /auth/logout, then clear all stored tokens and user data
  — redirect to login regardless of whether the API call succeeds

□ On app load: call GET /auth/me to validate the stored session
  — if 401: session expired — redirect to login

□ Do NOT send condominiumId in request bodies as an authorization source
  — the API resolves condominiumId server-side via the guard

□ Do NOT hardcode condominium slugs, condominium IDs, or user IDs in the frontend code

□ Do NOT hardcode the API base URL — always use the environment variable

□ Handle 401 → attempt token refresh first; if refresh fails, redirect to login

□ Handle 403 → show "access denied" — the user's role is insufficient

□ Handle 400 → display errors[0].reason as a user-facing validation message

□ Handle 404 → show empty state or "not found" — not an authentication error

□ Ensure local development frontend points to http://localhost:3001

□ Ensure production frontend points to the production API URL via environment variable

□ Never expose raw tokens in browser logs, analytics payloads, or error reporting tools
```
