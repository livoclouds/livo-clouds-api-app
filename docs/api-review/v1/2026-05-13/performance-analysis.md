# Performance Analysis

Performance findings grounded in code reads of services and DTOs at
`/Users/hiperezr/code/github/livoclouds/livo-clouds-api-app` on
2026-05-13. Findings cite `file:line` so a reviewer can verify.

Each row carries: severity, scope tag (`API-only` vs `API+web`),
suggested future fix, and verification status. No code changes are
proposed in this document — only analysis.

---

## P1 · Critical — Unbounded list endpoints (`findMany` with no
`take`/`skip`)

These return entire collections per tenant. They are safe today only
because seed tenants are small. With realistic data (200–500 residents,
24+ months of records, 50+ areas), payload size and DB cost grow
linearly per tenant and the queries become user-visible bottlenecks.

### P1.1 — Residents list returns full roster with 3-level include

- **File**: `src/modules/residents/residents.service.ts:15-25`
- **Symptom**: `findMany({ include: { vehicles, pets, additionalResidents } })`
  with no `take`. Response grows O(residents × (1 + vehicles + pets +
  additional)). For a 300-unit condominium with 2 vehicles + 1 pet per
  unit, payload is ~1200 rows shaped into 300 nested objects.
- **Impact**: Slow first paint on residents page; large JSON over the
  wire; memory pressure on API for large tenants.
- **Severity**: critical · **Scope**: **API+web** · **Status**: confirmed
- **Suggested future fix**: Add `page`/`limit` (default 50) with optional
  `q` (search by unit/name) and `paymentStatus` filter. Defer
  vehicles/pets/additional to per-row hydration on demand or limit each
  to first N. Web list currently loads everything — will need pagination
  controls and a query-string-bound state.

### P1.2 — Collection year matrix unbounded

- **File**: `src/modules/collection/collection.service.ts:16-26`
- **Symptom**: `collectionRecord.findMany({ where: { condominiumId, year } })`
  returns up to `residents × 12` rows per call with a nested resident
  select. No pagination.
- **Impact**: For 300 units × 12 months = 3,600 records per request.
  Today acceptable; doubles every fiscal year if requirements add prior
  years.
- **Severity**: critical · **Scope**: **API+web** · **Status**: confirmed
- **Suggested future fix**: Either move shaping server-side into a
  paginated matrix (paginate by resident range), or add cursor-based
  streaming if the entire grid is genuinely required for the UI.

### P1.3 — Resident account statement unbounded

- **File**: `src/modules/collection/collection.service.ts:35-117`
- **Symptom**: Loads **all** `transaction` rows for `{ condominiumId,
  residentId }` (no limit), all `collectionRecord` for the resident
  (optionally year/month filtered), then computes totals with JS `.reduce`.
- **Impact**: For a long-tenured resident the transaction list grows
  unbounded; reducing in JS pulls every row into memory. Today rows are
  in the dozens, but no upper bound.
- **Severity**: critical · **Scope**: **API+web** (web shows statement
  page) · **Status**: confirmed
- **Suggested future fix**:
  - Default `from`/`to` to last 12 months when not provided.
  - Compute `totalPaid` via `aggregate(_sum)` not via JS reduce.
  - Paginate transactions list inside the response.

### P1.4 — Overdue report unbounded

- **File**: `src/modules/reports/reports.service.ts:8-29`
- **Symptom**: All residents in OVERDUE status + nested unpaid records,
  then `.map()` to reshape.
- **Impact**: Scales linearly with overdue residents and historical
  unpaid months.
- **Severity**: critical · **Scope**: **API+web** · **Status**: confirmed
- **Suggested future fix**: Paginate, allow `q` filter and `minDebt`
  threshold. Shape the response in SQL via projection rather than `.map()`.

### P1.5 — Collection matrix report unbounded

- **File**: `src/modules/reports/reports.service.ts:31-52`
- **Symptom**: All residents + nested `collectionRecords` (filtered by
  year), then JS `.map`. Same shape as P1.2 but reports-routed.
- **Severity**: critical · **Scope**: **API+web** · **Status**: confirmed
- **Suggested future fix**: Same as P1.2. If the UI truly renders the
  entire grid, consider a server-side projection that returns a flat
  shape (`residentId,unitNumber,month,status,amountExpected,amountPaid`)
  and let the web pivot.

---

## P2 · High — In-memory aggregation that should be SQL

### P2.1 — Dashboard trend pulls full year of records

- **File**: `src/modules/dashboard/dashboard.service.ts:84-153`
- **Symptom**: Loads all `collectionRecord` rows for the year where
  status ∈ {PAID_ON_TIME, PAID_LATE, PARTIAL}, then builds a
  `Map<month, Set<residentId>>` in JS to compute per-month collection
  rates. Income/expense uses pre-aggregated `financialMonthlySummary`
  when present; falls back to a raw `$queryRaw` SQL for income/expense
  if summaries are missing.
- **Impact**: Per-month rate computation grows with payment volume; the
  full year of paid records is fetched even when 11 months won't change.
  When summaries are missing, collection rate path stays JS-based.
- **Severity**: high · **Scope**: **API-only** (response shape stable)
- **Status**: confirmed
- **Suggested future fix**: Cache the year's `Set<residentId>` per
  month in `financialMonthlySummary` (it already exists), or compute
  per-month distinct paid residents via SQL `COUNT(DISTINCT)` with a
  single grouped query.

### P2.2 — `classifyBatch` issues per-row UPDATE in chunks of 200

- **File**: `src/modules/classification/classification.service.ts:389-477`
- **Symptom**: After classifying each row in JS, the loop runs
  `prisma.transaction.update(...)` once per transaction inside
  `Promise.all` (200 concurrent updates per chunk).
- **Impact**: For a 1,000-row import that's 1,000 round-trip UPDATEs.
  Throughput is bounded by connection-pool size; chunk-of-200 in parallel
  can also saturate the pool.
- **Severity**: high · **Scope**: **API-only** · **Status**: confirmed
- **Suggested future fix**: Group rows by identical classification
  result and run grouped `updateMany`, or use Prisma's typed raw query
  with `CASE WHEN` to batch-update in one statement per chunk. Consider
  moving the whole classification step to a background queue (BullMQ /
  Vercel Queues) so the HTTP request returns immediately.

### P2.3 — Audit log written once per per-transaction state change

- **Files**: `classification.service.ts:777-790, 873-886, 913-926` (and
  many others)
- **Symptom**: Every approve / ignore / reopen writes an audit row. Bulk
  reconcile correctly writes a single aggregate audit row
  (`:983-994`).
- **Impact**: Per-row endpoints scale 1:1 with user clicks; acceptable
  for human use. Watch for cumulative log volume; AuditLog has
  per-column indexes but no `(condominiumId, createdAt)` composite —
  see `database-query-review.md`.
- **Severity**: low (currently) · **Scope**: API-only · **Status**: confirmed
- **Suggested future fix**: Add `(condominiumId, createdAt)` composite
  index when log table grows past a few million rows.

---

## P3 · Medium — Sequential I/O inside request lifecycle

### P3.1 — Import upload performs multiple sequential DB calls per file

- **File**: `src/modules/imports/imports.service.ts:78-191`
- **Symptom**: For each of up to 5 files, the handler does sequentially:
  hash → `findFirst({ fileHash })` → optional `delete` of stale
  COMPLETED batch → `create` → `update` with storage key. R2 upload also
  blocks the request.
- **Impact**: With 5 files = up to 5×(2-3 DB queries + 1 network upload)
  serialized. Hash+dedup could be parallel (`Promise.all`).
- **Severity**: medium · **Scope**: **API-only** · **Status**: confirmed
- **Suggested future fix**: Parallelize the per-file pipeline with
  `Promise.allSettled`. Verbose `console.log` statements (`:112, 125,
  138, 141, 165, 170, 176, 178`) should move to the NestJS `Logger` or
  be gated by environment. Consider streaming the upload to R2 instead
  of buffering 20MB × 5 files in memory.

### P3.2 — Petty cash create runs 2 sequential queries + folio computation

- **File**: `src/modules/petty-cash/petty-cash.service.ts:40-79`
- **Symptom**: `findFirst` last movement → `count` for folio →
  `create`. 3 sequential queries. Folio is `PC-${count+1}` which is
  **not race-safe** under concurrent writes.
- **Impact**: Low-frequency endpoint, but folio collisions possible
  under burst.
- **Severity**: medium (correctness + perf) · **Scope**: API-only
- **Status**: confirmed
- **Suggested future fix**: Use a DB sequence or a `@@unique` constraint
  on `(condominiumId, folio)` combined with retry-on-conflict. Parallel
  the first two reads with `Promise.all`.

### P3.3 — Transactions list includes nested `matchedCalendarEvent` →
`resident`

- **File**: `src/modules/transactions/transactions.service.ts:25-187`
  (all four list methods)
- **Symptom**: Each list endpoint requests `resident` plus
  `matchedCalendarEvent.resident` (2 levels). Prisma issues separate
  queries for nested relations (effectively a controlled N+1 — 3
  queries: tx, residents, calendarEvent+resident).
- **Impact**: Acceptable today (capped at 100 rows). For the
  `reconciled` list, additional includes `importBatch`, `matchedRule`,
  `reconciledBy` push it to 5+ relations.
- **Severity**: medium · **Scope**: API-only (web doesn't need to
  change if response shape stays the same — only the queries do)
- **Status**: confirmed
- **Suggested future fix**: Use `select` projections, or split the
  request into "list with minimum projection" + "row hydration on hover/expand".

### P3.4 — Calendar list has no upper bound

- **File**: `src/modules/calendar/calendar.service.ts:32-71`
- **Symptom**: Date range is optional. Without `from`/`to` the response
  returns every non-deleted event for the condominium.
- **Impact**: Multi-year calendars could return thousands. Web's
  `getCalendarEvents` always sends `from`/`to` today, so it's an
  unenforced contract.
- **Severity**: medium · **Scope**: API-only (require date range
  server-side) · **Status**: confirmed
- **Suggested future fix**: Require `from`/`to`, default to ±90 days,
  cap span at 12 months.

---

## P4 · Low — Performance is acceptable; document and monitor

### P4.1 — Throttler is per-user with reasonable defaults

- **File**: `src/app.module.ts:43-57`
- 20 req/10s burst + 120 req/min sustained. Adequate for the current
  UI but bulk operations + summary recalc loops can spike. The
  classification bulk-reconcile route already documents a tighter
  throttle (5/10s, 20/60s) — confirm enforcement in controller.
- **Severity**: low · **Scope**: API-only · **Status**: confirmed
- **Action**: monitor; revisit if bulk operations grow.

### P4.2 — Response envelope adds negligible overhead

- **File**: `src/common/interceptors/response.interceptor.ts`
- Wraps every success response in `{ data }`. No meaningful cost; only
  worth mentioning because it interacts with the pagination shape
  inconsistency (see `database-query-review.md` for the mismatch
  between `{ data, total, page, ... }` flat shape and `{ data, meta: {
  total, ... } }` envelope).
- **Severity**: low · **Scope**: documentation only · **Status**: confirmed

### P4.3 — Dashboard KPI uses parallel aggregates

- **File**: `src/modules/dashboard/dashboard.service.ts:8-82`
- Five parallel queries (income agg, expense agg, resident groupBy,
  recent 20 tx, settings). Well-structured. Watch the `take: 20` recent
  transactions include of resident — could be `select` projection but
  the load is minor.
- **Severity**: acceptable · **Scope**: documentation only
- **Status**: confirmed

### P4.4 — Executive summary uses correct SQL aggregation

- **File**: `src/modules/reports/reports.service.ts:54-111`
- 4 parallel aggregates (income/expense sums, resident/collection
  groupBy). Good pattern. Use this as the template for refactoring
  P1.4, P1.5, and P2.1.
- **Severity**: acceptable · **Scope**: pattern reference
- **Status**: confirmed

---

## Findings Summary Table

| ID | Severity | Scope | File | Action |
|---|---|---|---|---|
| P1.1 | critical | API+web | `residents.service.ts:15` | fix later (Phase 1) |
| P1.2 | critical | API+web | `collection.service.ts:16` | fix later (Phase 1) |
| P1.3 | critical | API+web | `collection.service.ts:35` | fix later (Phase 1) |
| P1.4 | critical | API+web | `reports.service.ts:8` | fix later (Phase 1) |
| P1.5 | critical | API+web | `reports.service.ts:31` | fix later (Phase 1) |
| P2.1 | high | API-only | `dashboard.service.ts:84` | fix later (Phase 2) |
| P2.2 | high | API-only | `classification.service.ts:389` | fix later (Phase 2) |
| P2.3 | low | API-only | classification audit writes | monitor |
| P3.1 | medium | API-only | `imports.service.ts:78` | fix later (Phase 2) |
| P3.2 | medium | API-only | `petty-cash.service.ts:40` | fix later (Phase 3) |
| P3.3 | medium | API-only | `transactions.service.ts:25` | fix later (Phase 3) |
| P3.4 | medium | API-only | `calendar.service.ts:32` | fix later (Phase 1) |
| P4.x | acceptable | n/a | various | monitor / document |

See `implementation-roadmap.md` for phasing detail and validation
strategy.
