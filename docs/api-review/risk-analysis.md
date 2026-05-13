# Risk Analysis

Non-performance risks identified by reading guards, controllers, services,
and DTOs at
`/Users/hiperezr/code/github/livoclouds/livo-clouds-api-app` on
2026-05-13. Categories covered: tenant isolation, authorization,
contract stability, data consistency, error handling, operational, and
"areas where current behavior is acceptable — do not change without
evidence."

Each row carries severity, affected files, mitigation, and an action
tag (`fix later` / `monitor` / `acceptable as-is`).

---

## R1 · Tenant isolation

### R1.1 — `CondominiumAccessGuard` is solid for slug-routed endpoints

- **File**: `src/common/guards/condominium-access.guard.ts:12-53`
- Validates `slug` from URL → resolves `condominiumId` from DB →
  checks active flag → enforces `user.condominiumId === condominium.id`
  except for `ROOT`. Stores `condominiumId` on request for downstream
  services. **No controller observed passing tenant info through body
  or query string.**
- **Risk**: **acceptable** · **Action**: `acceptable as-is`. Do not
  change without dedicated isolation review. **Status**: confirmed

### R1.2 — Guard returns `true` when no slug is present

- **File**: same, lines 22-24
- If neither `condominiumSlug` nor `slug` URL param is present, the
  guard short-circuits to allow. This is correct for routes that have
  no tenant context (auth, /condominiums root list, /health, /audit
  platform), but means the guard cannot be the only defense for routes
  added without a slug. **Status**: confirmed
- **Risk**: low · **Mitigation**: keep relying on per-controller
  `@Roles()` for non-slug endpoints (e.g., `condominiums.controller`
  uses ROOT role gating).
- **Action**: `monitor` — when adding new controllers, ensure every new
  tenant-scoped endpoint either routes under `:slug` or has an explicit
  role check.

### R1.3 — Bulk reconcile validates ownership before mutating

- **File**: `src/modules/classification/classification.service.ts:929-997`
- Pre-fetches all `transaction` rows by ID filtered by
  `condominiumId` and rejects the request if any ID is missing. **IDOR
  protection is explicit and correct.**
- **Risk**: **acceptable** · **Action**: `acceptable as-is` ·
  **Status**: confirmed

### R1.4 — Manual match validates resident belongs to condominium

- **File**: `src/modules/classification/classification.service.ts:504-527`
- Looks up resident by `{ id, condominiumId, deletedAt: null }` before
  updating. **Status**: confirmed.
- **Risk**: **acceptable** · **Action**: `acceptable as-is`.

### R1.5 — Soft-delete pattern is consistent

- Residents, Calendar events, and Users all filter by `deletedAt: null`.
  `Transaction` is append-only (no soft-delete; reconciled status
  represents lifecycle). **Status**: confirmed.
- **Risk**: low · **Action**: `acceptable as-is`. Watch for new modules
  that add soft-deletes — must extend the same predicate everywhere.

---

## R2 · Authorization

### R2.1 — JWT guard is global with public bypass

- **File**: `src/common/guards/jwt-auth.guard.ts:11-35`,
  registered global at `src/app.module.ts:81`
- All endpoints require JWT unless `@Public()` is set. Throws
  `UnauthorizedException` with a fixed reason — no token information
  leaks.
- **Risk**: **acceptable** · **Action**: `acceptable as-is`.

### R2.2 — `RolesGuard` is opt-in, not global

- **File**: `src/common/guards/roles.guard.ts:11-42`
- Only enforced where `@Roles(...)` is applied. If a sensitive endpoint
  forgets the decorator, any authenticated user passes (subject to
  tenant guard if `:slug` is in path).
- **Risk**: medium **for future controllers** · low for current code
- **Mitigation**: code review on new endpoints; consider linting or
  controller-level `@Roles()` in admin-only modules. **Action**:
  `monitor`. **Status**: confirmed.

### R2.3 — `/audit` platform endpoint downgrades to tenant on non-ROOT

- **File**: `src/modules/audit/audit.service.ts:55-86`
- If user is not ROOT, `findPlatformLogs` falls back to
  `findAll(condominiumId)`. This is intentional but means a non-ROOT
  request to `/audit` silently returns tenant-scoped data instead of
  403'ing. Behavior is acceptable but the route name implies platform
  scope — could confuse future API consumers.
- **Risk**: low · **Action**: `monitor`. Consider explicit 403 on
  non-ROOT hits to `/audit` for clarity. **Status**: confirmed.

---

## R3 · API contract stability

### R3.1 — Success response envelope `{ data }` is universal

- **File**: `src/common/interceptors/response.interceptor.ts`
- Every success response is wrapped. The web client wrappers
  (`src/lib/api/client.ts`, `src/lib/api/fetchClient.ts`) assume this
  shape. **Removing the interceptor or changing the wrapper would
  break every web call.** **Status**: confirmed.
- **Risk**: high if changed · **Action**: `acceptable as-is` (current
  contract). Document as load-bearing.

### R3.2 — Pagination response shape is inconsistent across modules

- Paginated lists return either:
  - **Flat**: `{ data, total, page, limit, totalPages }` —
    `transactions.service.ts`, `imports.service.ts`
  - **Envelope**: `{ data, meta: { total, page, limit, totalPages } }` —
    `audit.service.ts`
- Both end up nested inside `ResponseInterceptor`'s `{ data: ... }`,
  yielding `{ data: { data: [...], ...meta } }`.
- **Risk**: medium — web wrappers handle each shape ad-hoc; future
  generic table component cannot share parsing.
- **Action**: `fix later` — standardize when un-paginated endpoints
  graduate to paginated. **Scope**: **API+web** (web wrappers update
  in lockstep).
- **Status**: confirmed.

### R3.3 — Error response shape is uniform

- **File**: `src/common/filters/http-exception.filter.ts`
- All errors normalize to `{ errors: [{ code, reason, datetime, path }] }`.
  Web's `client.ts` decodes this directly via `ApiRequestError`. **Status**:
  confirmed.
- **Risk**: high if changed · **Action**: `acceptable as-is`.

### R3.4 — Unbounded list responses are an implicit contract

- Web pages that consume residents / collection / reports / inventory /
  petty-cash / calendar today expect "the entire dataset" because the
  API returns it. Adding `limit` later is a **breaking change** unless
  defaults preserve full-list behavior or the web is updated in
  lockstep.
- **Risk**: high if changed without coordination
- **Action**: `fix later` — see `web-impact-review.md` for the
  cross-repo coordination plan.

---

## R4 · Data consistency

### R4.1 — Petty-cash folio is generated from a non-atomic `count + 1`

- **File**: `src/modules/petty-cash/petty-cash.service.ts:54-57`,
  schema constraint at `prisma/schema.prisma:451`
- `folio = "PC-" + (count+1).padStart(4,'0')`. The schema enforces
  `@@unique([condominiumId, folio])`, so concurrent writes won't corrupt
  the table — but the second writer hits a Prisma `P2002` unique
  violation and the request fails with a generic 500. The race exists
  in the service code (count is not atomic); the DB constraint catches
  it but the user sees an unhelpful error.
- **Risk**: low (UX, no data corruption thanks to DB constraint)
- **Mitigation**: wrap creation in a retry-on-`P2002` loop, or replace
  `count + 1` with a per-condominium sequence / `MAX(folio) + 1` inside
  a row-locked `$transaction`.
- **Action**: `fix later`. **Status**: confirmed.

### R4.2 — `runningBalance` is computed from last row, not summed

- **File**: `src/modules/petty-cash/petty-cash.service.ts:41-52`
- The new row's balance derives from the last movement's
  `runningBalance`. Under concurrent writes, two creates can read the
  same last row and produce divergent balances. Same race as folio.
- **Risk**: medium (correctness)
- **Mitigation**: serialize via `$transaction` + `SELECT … FOR UPDATE`
  or change to a stored procedure that locks the latest row.
- **Action**: `fix later`. **Status**: confirmed.

### R4.3 — Excel parsing happens client-side in the web app

- Confirmed in `web-impact-review.md`. The API's `/imports/confirm`
  receives already-parsed transaction rows in the DTO body. This means
  the **web is the source of truth for parsing semantics** —
  date normalization, column alias resolution, locale-aware amount
  parsing. Any change to parsing rules requires a web release.
- **Risk**: medium (architectural — easy to forget)
- **Action**: `monitor`. Documented in `web-impact-review.md` so future
  changes are coordinated.

### R4.4 — Classification runs outside the import `$transaction`

- **File**: `src/modules/imports/imports.service.ts:326-333`
- After `tx.transaction.createMany(...)` commits, classification runs
  separately. If classification crashes, transactions are persisted but
  unclassified — recoverable via "reclassify batch" endpoint.
- **Risk**: low (recoverable, by design) · **Action**: `acceptable
  as-is`. Documented intent.

### R4.5 — `FinancialMonthlySummary` is recomputed on every reconcile

- **File**: `src/modules/classification/classification.service.ts:641-740`
- Every approve/ignore/reopen triggers an `upsertSummaryForMonth` that
  aggregates over the entire month. Bulk reconcile recomputes one
  summary per affected month (`:964-975`).
- **Risk**: low (correctness is good; perf cost is bounded by month size)
- **Action**: `acceptable as-is`. Could batch summaries on bulk
  endpoints in a future phase if monthly tx volume grows large.

---

## R5 · Operational risks

### R5.1 — `console.log` instrumentation in production code

- **File**: `src/modules/imports/imports.service.ts:112, 125, 138, 141,
  165, 170, 176, 178, 233, 241, 270, 328, 334`
- Direct `console.log` / `console.error` calls; bypasses the NestJS
  logger and Fastify log format.
- **Risk**: low (operational) · **Mitigation**: replace with
  `this.logger.log(...)` and remove sensitive fields (hash prefixes
  appear safe today, but path discipline is worth establishing).
- **Action**: `fix later` (cleanup). **Status**: confirmed.

### R5.2 — File buffering for uploads (no streaming)

- **File**: `src/main.ts:25`, `src/modules/imports/imports.service.ts:78`
- Fastify multipart is configured with 20 MB × up to 5 files = 100 MB
  in-memory per request. SHA-256 computed over the in-memory buffer.
- **Risk**: medium under load · **Mitigation**: stream files to disk or
  directly to R2 with streaming hash. **Action**: `fix later`.
  **Status**: confirmed.

### R5.3 — R2 upload failures are swallowed

- **File**: `src/modules/imports/imports.service.ts:177-179`
- Catches and logs storage errors but still returns "queued" status to
  the client. The DB row is created without `storageKey`, but the user
  has no signal that retention failed.
- **Risk**: medium (data loss — bank statements not retained)
- **Mitigation**: surface a warning in the upload response and/or set
  the batch status to a recoverable state. **Action**: `fix later`.
  **Status**: confirmed.

### R5.4 — Throttler limits may be tight for bulk endpoints

- **File**: `src/app.module.ts:43-57`
- 20 req/10s burst applies to all routes unless a controller overrides.
  Bulk reconcile already declares a tighter throttle in its
  endpoint-inventory entry; verify it's actually enforced via
  `@Throttle()` on the controller method.
- **Risk**: low · **Action**: `monitor`. **Status**: needs verification
  (controller decorator not inspected in this pass).

### R5.5 — Swagger is enabled at `/docs` unconditionally

- **File**: `src/main.ts:42-52`
- Even in production, Swagger UI is served. Schema disclosure is
  generally acceptable for an authenticated API, but worth confirming
  the environment policy.
- **Risk**: low · **Action**: `monitor` — decide whether to gate by
  `NODE_ENV`. **Status**: confirmed.

---

## R6 · Areas explicitly acceptable — do not change without evidence

| Area | File | Why acceptable |
|---|---|---|
| Global JWT auth guard | `app.module.ts:81` | Standard, public bypass via decorator works |
| Tenant guard via slug | `condominium-access.guard.ts` | Single source of truth, used consistently |
| Response envelope | `response.interceptor.ts` | Web wrappers depend on it; stable contract |
| Error envelope | `http-exception.filter.ts` | Same |
| Append-only transactions | schema + classification flow | Audit traceability requires immutability |
| Soft-delete pattern | residents, calendar, users | Consistent filtering predicate |
| Parallel aggregates in dashboard/reports | `dashboard.service.ts:8`, `reports.service.ts:54` | Correct pattern; use as template for future fixes |
| Index coverage on hot models | `prisma/schema.prisma` | Audited in `database-query-review.md` — well-covered |
| `$transaction` around imports Stages 5–6 | `imports.service.ts:265-326` | Correctly atomic |
| Bulk reconcile IDOR check | `classification.service.ts:935-943` | Correct ownership validation |

---

## Risk Summary

| ID | Severity | Action | Status |
|---|---|---|---|
| R1.1 | acceptable | acceptable as-is | confirmed |
| R1.2 | low | monitor | confirmed |
| R1.3 | acceptable | acceptable as-is | confirmed |
| R1.4 | acceptable | acceptable as-is | confirmed |
| R1.5 | low | acceptable as-is | confirmed |
| R2.1 | acceptable | acceptable as-is | confirmed |
| R2.2 | medium (forward-looking) | monitor | confirmed |
| R2.3 | low | monitor | confirmed |
| R3.1 | high if changed | acceptable as-is | confirmed |
| R3.2 | medium | fix later (API+web) | confirmed |
| R3.3 | high if changed | acceptable as-is | confirmed |
| R3.4 | high if changed | fix later (coordinated) | confirmed |
| R4.1 | low | fix later | confirmed |
| R4.2 | medium | fix later | confirmed |
| R4.3 | medium | monitor | confirmed |
| R4.4 | low | acceptable as-is | confirmed |
| R4.5 | low | acceptable as-is | confirmed |
| R5.1 | low | fix later | confirmed |
| R5.2 | medium | fix later | confirmed |
| R5.3 | medium | fix later | confirmed |
| R5.4 | low | monitor (verify throttle decorator) | needs verification |
| R5.5 | low | monitor | confirmed |
