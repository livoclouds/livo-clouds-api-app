# Database & Query Review

Audit of Prisma query patterns and `prisma/schema.prisma` index
coverage. Read-only review; no schema or migration changes proposed
here. Grounded in code reads from
`/Users/hiperezr/code/github/livoclouds/livo-clouds-api-app` on
2026-05-13.

---

## Schema scope

16 models, 19 enums. Hot models (by traffic and relation density):

| Model | Relations | Notes |
|---|---|---|
| `Condominium` | 8 | tenant root |
| `Transaction` | 8 | most-queried; append-only intent |
| `Resident` | 6 | unique `(condominiumId, unitNumber)` |
| `CalendarEvent` | 3 | terrace bookings; soft-delete |
| `CollectionRecord` | 1 | unique `(condominiumId, residentId, year, month)` |
| `ImportBatch` | 3 | dedup via `fileHash` |
| `AuditLog` | 2 | append-only |
| `PettyCashMovement` | 3 | unique `(condominiumId, folio)` |
| `FinancialMonthlySummary` | 1 | unique `(condominiumId, year, month)` |

---

## Index coverage

Extracted via `grep -n "@@index\|@@unique" prisma/schema.prisma`.
Annotations below note whether each index supports current queries.

### `Transaction` — well-covered (lines 582–594)

```
@@index([condominiumId])
@@index([importBatchId])
@@index([residentId])
@@index([transactionDate])
@@index([flowType])
@@index([condominiumId, classificationStatus])
@@index([condominiumId, transactionDate, flowType])
@@index([residentId, paymentPeriodYear, paymentPeriodMonth])
@@index([condominiumId, paymentPeriodYear, paymentPeriodMonth])
@@index([condominiumId, requiresReviewReason])
@@index([condominiumId, reconciliationStatus])
@@index([condominiumId, reconciliationStatus, transactionDate])
@@index([matchedCalendarEventId])
```

**Assessment**: Comprehensive. The list queries in
`transactions.service.ts` (`findAll`, `findUnmatched`, `findClassified`,
`findReconciled`) all filter on combinations covered by these indexes.
Aggregations in `dashboard.service.ts` and
`reports.service.getExecutiveSummary` use
`(condominiumId, transactionDate, flowType)` directly. **No new
indexes required at current scale.**

### `Resident` — well-covered (lines 362–365)

```
@@unique([condominiumId, unitNumber])
@@index([condominiumId])
@@index([paymentStatus])
@@index([deletedAt])
```

**Assessment**: `reports.service.getOverdue`'s
`{ condominiumId, paymentStatus, deletedAt }` filter is supported.
The `deletedAt` filter is on its own index — Postgres can index-merge.
**Acceptable.**

### `CollectionRecord` — well-covered (lines 618–622)

```
@@unique([condominiumId, residentId, year, month])
@@index([condominiumId])
@@index([residentId])
@@index([year, month])
@@index([status])
```

**Assessment**: Covers the common `{ condominiumId, year }` and
`{ condominiumId, residentId }` filters. Status filter in
`dashboard.service.getMonthlyTrend` (status IN [...]) benefits from
the `status` index when status counts are skewed. **Acceptable.**

### `CalendarEvent` — well-covered (lines 789–792)

```
@@index([condominiumId])
@@index([condominiumId, startDate, endDate])
@@index([condominiumId, eventType])
@@index([deletedAt])
```

**Assessment**: The composite `(condominiumId, startDate, endDate)`
covers terrace overlap checks (`calendar.service.ts:128-142, 205-220`)
and the calendar list (`:55-70`). **No gaps.**

### `ImportBatch` — well-covered (lines 534–537)

```
@@index([condominiumId])
@@index([fileHash])
@@index([status])
@@index([createdAt])
```

**Assessment**: SHA-256 dedup query (`imports.service.ts:119, 235`)
uses `(condominiumId, fileHash)` — both columns indexed individually.
Postgres can index-merge but a composite `(condominiumId, fileHash)`
would be slightly faster and removes the merge cost. **Optional
optimization for very high write volume.**

### `AuditLog` — adequate per-column, missing composite (lines 647–652)

```
@@index([condominiumId])
@@index([userId])
@@index([module])
@@index([action])
@@index([result])
@@index([createdAt])
```

**Assessment**: All filters on `audit.service.ts:findAll` are covered,
but `{ condominiumId, createdAt DESC }` ordering would benefit from a
composite index when the log grows past low millions of rows.
**Recommendation (when needed)**: add `@@index([condominiumId,
createdAt])` for tenant-scoped paginated reads. Not urgent today.

### `PettyCashMovement` — covered (lines 451–454)

```
@@unique([condominiumId, folio])
@@index([condominiumId])
@@index([status])
@@index([date])
```

**Assessment**: Unique constraint on folio already enforces correctness
(see `risk-analysis.md` R4.1). Acceptable.

### `FinancialMonthlySummary` — covered (lines 697–698)

```
@@unique([condominiumId, year, month])
@@index([condominiumId])
```

**Assessment**: `upsert` in
`classification.service.upsertSummaryForMonth` uses the composite
unique. **Acceptable.**

### Smaller models (`Vehicle`, `Pet`, `AdditionalResident`, `InventoryItem`, `CommonArea`, `Notification`, `RefreshToken`, `ReconciliationRule`, `ReconciliationCorrectionPattern`, `PaymentAllocation`)

All have at minimum `@@index([condominiumId])` or `@@index([residentId])`
where appropriate. `RefreshToken` indexes `userId` and `token` (lines
327–328). `ReconciliationRule` indexes `(condominiumId, isActive)` and
`(condominiumId, priority)` (lines 718–719), supporting the active-rule
load in `classification.service.classifyBatch`.

**Overall index posture**: Comprehensive and tuned. The author clearly
designed indexes around the major query shapes. No critical gaps were
identified.

---

## Query patterns — concerns

### Q1 · Unbounded `findMany` (10 endpoints)

Detailed in `performance-analysis.md` P1.x and P3.4. Summary:

| File:line | Method | Includes |
|---|---|---|
| `residents.service.ts:15` | `findAll` | vehicles + pets + additionalResidents |
| `collection.service.ts:16` | `findAll` (year) | resident (select) |
| `collection.service.ts:35` | `getAccountStatement` | — (loads tx + records) |
| `reports.service.ts:8` | `getOverdue` | nested collectionRecords (filtered) |
| `reports.service.ts:31` | `getCollectionMatrix` | nested collectionRecords (year) |
| `inventory.service.ts:12` | `findAllAreas` | inventoryItems |
| `inventory.service.ts:50` | `findAllItems` | commonArea (select) |
| `petty-cash.service.ts:14` | `findAll` | registeredBy (select) |
| `calendar.service.ts:32` | `findAll` | resident + createdBy (date range optional) |
| `dashboard.service.ts:93` | `getMonthlyTrend` | full-year collectionRecords |

**Pattern issue**: every list endpoint that has no `take` is a
latent payload problem. They are individually small today but cluster
together — fixing them benefits from a shared `PaginationDto` and
response shape.

### Q2 · Pagination response-shape inconsistency

Two shapes coexist:

```jsonc
// transactions, imports (flat)
{ data, total, page, limit, totalPages }

// audit (envelope)
{ data, meta: { total, page, limit, totalPages } }
```

After `ResponseInterceptor` wraps each, the wire formats are:

```jsonc
// transactions/imports
{ data: { data: [...], total, page, limit, totalPages } }

// audit
{ data: { data: [...], meta: {...} } }
```

The `common/types/index.ts:28-37` `PaginatedResult<T>` interface
declares the envelope shape but services don't all conform.

**Recommendation**: pick one shape (`{ data, meta }` matches the
declared type and is cleaner to extend). Roll it out when graduating
un-paginated endpoints to paginated. **Scope**: API+web.

### Q3 · Deep includes on hot list endpoints

`transactions.service.ts:25-187` requests
`matchedCalendarEvent.resident` plus other relations. Prisma fans these
out into separate `IN (...)` queries — a controlled N+1 pattern that's
cheap for small result sets but balloons when the response carries
hundreds of rows. With `limit ≤ 100` enforced via DTO
(`list-transactions.dto.ts:16`), today's cost is bounded.

**Recommendation**: switch to explicit `select` projections on the list
endpoints to ship only the columns the table renders; let detail views
hydrate on demand. **Scope**: API-only if the web doesn't read the
trimmed fields.

### Q4 · Per-row `update` inside batch operations

`classification.service.classifyBatch`
(`classification.service.ts:434-477`) runs 200 parallel
`prisma.transaction.update(...)` per chunk. Each is a round-trip;
Prisma can't batch heterogeneous updates today. Options:

- Group rows by identical update payload and run `updateMany`.
- Use `prisma.$executeRaw` with a single `UPDATE ... SET ... FROM
  (VALUES ...)` per chunk.
- Move the loop to a queue worker so the import response returns fast.

**Scope**: API-only; classification output is internal.

### Q5 · In-memory aggregation that should be SQL

`dashboard.service.getMonthlyTrend` (`:84-153`) builds a `Map<month,
Set<residentId>>` in JS to compute distinct paid residents per month.
Equivalent SQL:

```sql
SELECT month, COUNT(DISTINCT resident_id) AS paid_count
FROM collection_records
WHERE condominium_id = $1
  AND year = $2
  AND status IN ('PAID_ON_TIME','PAID_LATE','PARTIAL')
GROUP BY month;
```

Combined with `totalResidents` (already fetched via `count`) gives the
rate without loading every row. **Scope**: API-only.

`reports.service.getOverdue` and `getCollectionMatrix` shape data via
`.map()` after loading. Acceptable until the list grows; then move
shaping into SQL or a `select` projection.

### Q6 · Lookups that could be parallelized

`imports.service.upload` (`:78-191`) does hash → `findFirst({ fileHash })`
→ optional delete → `create` → R2 upload → `update` sequentially per
file. Hash computation and dedup lookup can be parallel; for 5 files,
the dedup lookups can be batched into a single `findMany({ where: {
fileHash: { in: [...] } } })`.

**Scope**: API-only.

---

## Migration recommendations (deferred)

These are not migrations to run now — they are written down so a future
implementation phase can pick them up. Each is dependent on growth that
isn't here yet.

| Suggestion | When to apply | Risk |
|---|---|---|
| Composite `@@index([condominiumId, createdAt])` on `AuditLog` | When tenant audit log exceeds ~1M rows | low |
| Composite `@@index([condominiumId, fileHash])` on `ImportBatch` | If dedup queries become hot under high import volume | low |
| Composite `@@index([condominiumId, transactionDate])` on `Transaction` for paginated lists | Likely unnecessary — `(condominiumId, transactionDate, flowType)` already covers it via index prefix | none |
| Materialized monthly trend view | Only if dashboard P95 latency degrades after fixing P2.1 | medium |
| Per-tenant sequence for petty-cash folio | When concurrency on `petty-cash.create` becomes real | low |

---

## Summary

Indexes are **well-designed and adequate for today's load**. The main
opportunities are in:

1. **Adding pagination** to 10 unbounded list endpoints (Q1)
2. **Standardizing pagination response shape** across modules (Q2)
3. **Slimmer `select` projections** on transactions list endpoints (Q3)
4. **Batching per-row updates** in `classifyBatch` (Q4)
5. **Pushing aggregation into SQL** for `getMonthlyTrend`, `getOverdue`,
   `getCollectionMatrix` (Q5)
6. **Parallelizing dedup lookups** in `imports.upload` (Q6)

All six are documented in `performance-analysis.md` with severity and
scope. See `implementation-roadmap.md` for phasing.
