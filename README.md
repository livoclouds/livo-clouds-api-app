# LivoClouds API

NestJS backend for the LivoClouds condominium management platform.

## Stack

- **NestJS 10** with Fastify adapter
- **Prisma 5** + PostgreSQL (Neon)
- **JWT** authentication (access + refresh tokens)
- **Swagger/OpenAPI** at `/docs`
- **TypeScript** strict mode

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Neon connection strings and secrets:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/livoclouds?sslmode=require&pgbouncer=true
DIRECT_URL=postgresql://USER:PASSWORD@HOST/livoclouds?sslmode=require
JWT_SECRET=your-secure-secret-min-32-chars
JWT_REFRESH_SECRET=another-secure-secret-min-32-chars
CORS_ORIGIN=http://localhost:3000,https://app.livoclouds.com
```

### 3. Generate Prisma client

```bash
npm run prisma:generate
```

### 4. Run migrations

```bash
npm run prisma:migrate
```

### 5. Seed database

```bash
npm run prisma:seed
```

Seed creates:
- 2 condominiums: `cotoalameda`, `cotolospatos`
- Test users per condominium
- Sample residents, inventory, and petty cash data

### 6. Start the API

```bash
# Development (with watch mode)
npm run start:dev

# Production
npm run build && npm run start:prod
```

API runs at **http://localhost:3001**

### 7. Open Swagger

Visit **http://localhost:3001/docs**

Click "Authorize" and enter a Bearer token from `POST /auth/login`.

### 8. Health check

```bash
curl http://localhost:3001/health
# { "data": { "status": "ok" } }
```

## Test Accounts

| Email | Password | Role | Condominium |
|-------|----------|------|-------------|
| root@demo.com | Root1234! | ROOT | All |
| admin@cotoalameda.com | Admin1234! | TENANT_ADMIN | cotoalameda |
| view@cotoalameda.com | View1234! | READ_ONLY | cotoalameda |
| guard@cotoalameda.com | Guard1234! | GUARD | cotoalameda |
| admin@cotolospatos.com | Admin1234! | TENANT_ADMIN | cotolospatos |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Dev server with watch |
| `npm run build` | Compile TypeScript |
| `npm run start:prod` | Production server |
| `npm run lint` | ESLint |
| `npm run test` | Unit tests |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | Run dev migrations |
| `npm run prisma:deploy` | Apply migrations in production |
| `npm run prisma:seed` | Seed database |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run prisma:reset` | Reset database (dev only) |

## API Overview

### Authentication
```
POST /auth/login      - Login
POST /auth/logout     - Revoke refresh token
POST /auth/refresh    - Rotate tokens
GET  /auth/me         - Current user
```

### Multi-Tenant Routes (all under `/condominiums/:slug/`)
```
GET/POST/PATCH/DELETE /condominiums/:slug/residents
GET/POST/PATCH/DELETE /condominiums/:slug/residents/:id/vehicles
GET/POST              /condominiums/:slug/petty-cash
POST                  /condominiums/:slug/petty-cash/:id/approve
GET/POST/PATCH/DELETE /condominiums/:slug/common-areas
GET/POST/PATCH/DELETE /condominiums/:slug/inventory
POST                  /condominiums/:slug/imports/upload
GET                   /condominiums/:slug/dashboard
GET                   /condominiums/:slug/reports/overdue
GET                   /condominiums/:slug/reports/collection-matrix
GET                   /condominiums/:slug/reports/executive-summary
GET/PATCH             /condominiums/:slug/settings
GET                   /condominiums/:slug/audit
GET                   /condominiums/:slug/notifications
```

## Multi-Tenancy

All data is scoped to a `condominiumId`. The `CondominiumAccessGuard` enforces that:
- Non-root users can only access their own condominium
- Root users have platform-wide access
- All service methods filter by `condominiumId` at the query level

## Neon Configuration

Prisma requires two connection strings for Neon:

- `DATABASE_URL`: Pooled connection (PgBouncer) — used at runtime
- `DIRECT_URL`: Direct connection — used only for `prisma migrate`

See `.env.example` for the format.
