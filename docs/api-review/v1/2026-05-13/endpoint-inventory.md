# Endpoint Inventory

Inventory of every HTTP endpoint exposed by the LivoClouds API as of
2026-05-13. One row per route. Tagging conventions match
`risk-analysis.md` and `performance-analysis.md`.

**Legend**
- **Paged**: `yes` = `page`/`limit` params honored; `no` = unbounded; `n/a` = mutation or detail
- **Risk**: `critical` / `high` / `medium` / `low` / `acceptable`
- **Tenant guard**: `slug` = `CondominiumAccessGuard` via URL slug; `jwt` = JWT only;
  `public` = `@Public()`; `role` = role gate via `@Roles()`
- **Web consumer**: which Next.js page/proxy uses it (best-effort from
  `src/lib/api/*.ts` and `src/app/api/**/route.ts` in the web repo)

---

## auth (`src/modules/auth/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| POST | `/auth/register` | Register new user | n/a | public | (unused by web) | acceptable |
| POST | `/auth/login` | Authenticate, return access + refresh tokens | n/a | public | `POST /api/auth/login` | acceptable |
| POST | `/auth/refresh` | Refresh access token | n/a | public | `POST /api/auth/refresh` | acceptable |
| POST | `/auth/logout` | Revoke refresh token | n/a | jwt | `POST /api/auth/logout` | acceptable |
| GET  | `/auth/me` | Current user profile | n/a | jwt | `GET /api/auth/me` | acceptable |

## condominiums (`src/modules/condominiums/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums` | List condominiums (ROOT: all, others: own) | no | jwt+role | platform admin (future) | low |
| GET    | `/condominiums/:slug` | Get condominium + settings | n/a | slug | settings pages | acceptable |
| POST   | `/condominiums` | Create condominium (ROOT only) | n/a | role | platform admin | acceptable |
| PATCH  | `/condominiums/:id` | Update condominium | n/a | role | platform admin | acceptable |
| DELETE | `/condominiums/:id` | Soft-deactivate condominium | n/a | role | platform admin | acceptable |

## users (`src/modules/users/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums/:slug/users` | List condominium users | no | slug | (admin only) | low |
| GET    | `/condominiums/:slug/users/:id` | User detail | n/a | slug | (admin only) | acceptable |
| POST   | `/condominiums/:slug/users` | Invite user | n/a | slug+role | (admin only) | acceptable |
| PATCH  | `/condominiums/:slug/users/:id` | Update user | n/a | slug+role | (admin only) | acceptable |
| DELETE | `/condominiums/:slug/users/:id` | Soft-delete user | n/a | slug+role | (admin only) | acceptable |

## residents (`src/modules/residents/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums/:slug/residents` | List all residents + vehicles + pets + additional | **no** | slug | `GET /api/residents` (Residents page, dual fetch w/ settings) | **critical** |
| GET    | `/condominiums/:slug/residents/:id` | Resident + last 12 collection records | n/a | slug | resident detail | medium |
| POST   | `/condominiums/:slug/residents` | Create resident | n/a | slug | resident form | acceptable |
| PATCH  | `/condominiums/:slug/residents/:id` | Update resident | n/a | slug | resident form | acceptable |
| DELETE | `/condominiums/:slug/residents/:id` | Soft-delete | n/a | slug | resident form | acceptable |
| POST   | `/condominiums/:slug/residents/:id/vehicles` | Add vehicle | n/a | slug | resident detail | acceptable |
| PATCH  | `/condominiums/:slug/residents/:id/vehicles/:vid` | Update vehicle | n/a | slug | resident detail | acceptable |
| DELETE | `/condominiums/:slug/residents/:id/vehicles/:vid` | Delete vehicle | n/a | slug | resident detail | acceptable |
| POST   | `/condominiums/:slug/residents/:id/pets` | Add pet | n/a | slug | resident detail | acceptable |
| PATCH  | `/condominiums/:slug/residents/:id/pets/:pid` | Update pet | n/a | slug | resident detail | acceptable |
| DELETE | `/condominiums/:slug/residents/:id/pets/:pid` | Delete pet | n/a | slug | resident detail | acceptable |

## transactions (`src/modules/transactions/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET | `/condominiums/:slug/transactions` | List w/ filters (flow, status, range, resident) | yes (limit ≤ 100) | slug | `GET /api/transactions` (Transactions page) | medium |
| GET | `/condominiums/:slug/transactions/unmatched` | NEEDS_REVIEW + PENDING | yes (≤ 100) | slug | `GET /api/transactions/unmatched` | medium |
| GET | `/condominiums/:slug/transactions/classified` | Classified (AUTO/MANUAL) + PENDING | yes (≤ 100) | slug | `GET /api/transactions/classified` | medium |
| GET | `/condominiums/:slug/transactions/reconciled` | APPROVED/IGNORED | yes (≤ 100) | slug | `GET /api/transactions/reconciled` | medium |

## classification (mounted under transactions controller; `src/modules/classification/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| POST   | `/condominiums/:slug/imports/:batchId/classify` | Re-classify a batch | n/a | slug | batch detail | high |
| PATCH  | `/condominiums/:slug/transactions/:id/match` | Manual resident match | n/a | slug | transaction row | acceptable |
| PATCH  | `/condominiums/:slug/transactions/:id/classify` | Manual classify (unit + concept + period) | n/a | slug | transaction row | acceptable |
| PATCH  | `/condominiums/:slug/transactions/:id/unmatch` | Remove match | n/a | slug | transaction row | acceptable |
| PATCH  | `/condominiums/:slug/transactions/:id/approve` | Approve (→ APPROVED) | n/a | slug | reconciliation | medium |
| PATCH  | `/condominiums/:slug/transactions/:id/ignore` | Ignore (→ IGNORED) | n/a | slug | reconciliation | medium |
| PATCH  | `/condominiums/:slug/transactions/:id/reopen` | Reopen (→ PENDING) | n/a | slug | reconciliation | medium |
| POST   | `/condominiums/:slug/transactions/bulk-reconcile` | Bulk approve/ignore/reopen (throttled separately) | n/a | slug | reconciliation | high |

## imports (`src/modules/imports/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums/:slug/imports` | List batches w/ filters | yes (default 15) | slug | `GET /api/imports/batches` | low |
| GET    | `/condominiums/:slug/imports/:id` | Batch detail + first 50 tx | n/a | slug | batch detail | medium |
| POST   | `/condominiums/:slug/imports/upload` | Upload up to 5 files, SHA-256, dedup | n/a | slug | `POST /api/imports/upload` | high |
| POST   | `/condominiums/:slug/imports/confirm` | Persist parsed tx + classify | n/a | slug | `POST /api/imports/confirm` | high |
| DELETE | `/condominiums/:slug/imports/:id` | Mark FAILED ("delete") | n/a | slug | batch action | acceptable |

## collection (`src/modules/collection/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET   | `/condominiums/:slug/collection?year=Y` | All collection records for year | **no** | slug | collection matrix (web) | **critical** |
| GET   | `/condominiums/:slug/collection/residents/:id` | All records for a resident | **no** | slug | resident statement | high |
| GET   | `/condominiums/:slug/collection/residents/:id/account-statement` | All tx + records + summary | **no** | slug | resident statement | **critical** |
| PATCH | `/condominiums/:slug/collection/:id` | Update collection record | n/a | slug | manual edit | acceptable |

## reports (`src/modules/reports/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET | `/condominiums/:slug/reports/overdue` | All overdue residents + unpaid records | **no** | slug | `fetchOverdueReport` | **critical** |
| GET | `/condominiums/:slug/reports/collection-matrix?year=Y` | All residents × 12 months | **no** | slug | `fetchCollectionMatrix` | **critical** |
| GET | `/condominiums/:slug/reports/executive-summary?year=&month=` | KPIs for one month (aggregates) | n/a | slug | `fetchExecutiveSummary` | acceptable |

## dashboard (`src/modules/dashboard/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET | `/condominiums/:slug/dashboard?year=&month=` | KPIs + 20 recent tx | n/a | slug | dashboard page (ISR 60s) | medium |
| GET | `/condominiums/:slug/dashboard/trend?year=Y` | 12-month trend (income/expense/rate) | n/a | slug | dashboard trend (ISR 60s) | **high** |

## calendar (`src/modules/calendar/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums/:slug/calendar/events?from=&to=&type=&status=` | List events (date range optional) | **no** | slug | `getCalendarEvents` | high |
| GET    | `/condominiums/:slug/calendar/events/:id` | Event detail | n/a | slug | event modal | acceptable |
| POST   | `/condominiums/:slug/calendar/events` | Create event (terrace overlap check) | n/a | slug | `createCalendarEvent` | medium |
| PATCH  | `/condominiums/:slug/calendar/events/:id` | Update event | n/a | slug | `updateCalendarEvent` | medium |
| DELETE | `/condominiums/:slug/calendar/events/:id` | Soft-delete | n/a | slug | `deleteCalendarEvent` | acceptable |

## audit (`src/modules/audit/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET | `/audit` | Platform-wide logs (ROOT) or fallback to tenant | yes (≤ 200) | jwt+role | platform admin | low |
| GET | `/condominiums/:slug/audit` | Tenant audit logs | yes (≤ 200) | slug | (admin only) | low |

## settings (`src/modules/settings/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET   | `/condominiums/:slug/settings/general` | General settings | n/a | slug | settings/general | acceptable |
| PATCH | `/condominiums/:slug/settings/general` | Update general | n/a | slug | settings/general | acceptable |
| GET   | `/condominiums/:slug/settings/fees` | Fee schedule | n/a | slug | settings/fees | acceptable |
| PATCH | `/condominiums/:slug/settings/fees` | Update fees | n/a | slug | settings/fees | acceptable |
| GET   | `/condominiums/:slug/settings/financial` | Financial settings | n/a | slug | settings/financial | acceptable |
| PATCH | `/condominiums/:slug/settings/financial` | Update financial | n/a | slug | settings/financial | acceptable |
| GET   | `/condominiums/:slug/settings/terrace` | Terrace booking config | n/a | slug | settings/terrace | acceptable |
| PATCH | `/condominiums/:slug/settings/terrace` | Update terrace | n/a | slug | settings/terrace | acceptable |
| GET   | `/condominiums/:slug/settings/validate-fees` | Validate fees configured | n/a | slug | upload preflight | acceptable |

## reconciliation-rules (`src/modules/reconciliation-rules/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums/:slug/settings/reconciliation-rules` | List rules | yes | slug | settings/rules | low |
| GET    | `/condominiums/:slug/settings/reconciliation-rules/:id` | Rule detail | n/a | slug | settings/rules | acceptable |
| POST   | `/condominiums/:slug/settings/reconciliation-rules` | Create rule | n/a | slug | settings/rules | acceptable |
| PATCH  | `/condominiums/:slug/settings/reconciliation-rules/:id` | Update rule | n/a | slug | settings/rules | acceptable |
| DELETE | `/condominiums/:slug/settings/reconciliation-rules/:id` | Delete rule | n/a | slug | settings/rules | acceptable |

## inventory (`src/modules/inventory/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums/:slug/common-areas` | All areas + nested items | **no** | slug | common areas page | high |
| POST   | `/condominiums/:slug/common-areas` | Create area | n/a | slug | common areas form | acceptable |
| PATCH  | `/condominiums/:slug/common-areas/:id` | Update area | n/a | slug | common areas form | acceptable |
| DELETE | `/condominiums/:slug/common-areas/:id` | Delete area | n/a | slug | common areas form | acceptable |
| GET    | `/condominiums/:slug/inventory` | All inventory items + commonArea | **no** | slug | inventory page | high |
| POST   | `/condominiums/:slug/inventory` | Create item | n/a | slug | inventory form | acceptable |
| PATCH  | `/condominiums/:slug/inventory/:id` | Update item | n/a | slug | inventory form | acceptable |
| DELETE | `/condominiums/:slug/inventory/:id` | Delete item | n/a | slug | inventory form | acceptable |

## petty-cash (`src/modules/petty-cash/`)

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums/:slug/petty-cash` | All movements | **no** | slug | petty cash page | high |
| GET    | `/condominiums/:slug/petty-cash/:id` | Movement detail | n/a | slug | movement detail | acceptable |
| POST   | `/condominiums/:slug/petty-cash` | Create movement (computes runningBalance) | n/a | slug | movement form | medium |
| POST   | `/condominiums/:slug/petty-cash/:id/approve` | Approve | n/a | slug | movement detail | acceptable |
| POST   | `/condominiums/:slug/petty-cash/:id/reject` | Reject | n/a | slug | movement detail | acceptable |

## notifications, storage, health

| Method | Path | Purpose | Paged | Tenant guard | Web consumer | Risk |
|---|---|---|---|---|---|---|
| GET    | `/condominiums/:slug/notifications` | List notifications | no | slug | notifications panel | low |
| PATCH  | `/condominiums/:slug/notifications/:id/read` | Mark read | n/a | slug | notifications | acceptable |
| GET    | `/health` | Liveness probe | n/a | public | (uptime monitor) | acceptable |

`storage` exposes no controller — internal service used by `imports`.

---

## Endpoint Risk Summary

Total endpoints ≈ 106 across 17 modules + 1 health check.

| Severity | Count | Modules |
|---|---|---|
| **critical** | 5 | residents (list), collection (year, statement), reports (overdue, matrix) |
| **high** | 9 | classify batch, bulk reconcile, imports upload/confirm, calendar list, common-areas list, inventory list, petty-cash list, dashboard trend, resident statement |
| **medium** | ~12 | transactions list × 4, dashboard kpis, imports detail, resident detail, calendar create/update, transactions approve/ignore/reopen, petty-cash create |
| **low / acceptable** | rest | CRUD mutations, auth, settings, reconciled rules, audit, health |

See `performance-analysis.md` and `risk-analysis.md` for per-finding
detail and recommended action.
