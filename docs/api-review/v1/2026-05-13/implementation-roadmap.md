# Implementation Roadmap

Phased plan for acting on the findings in `performance-analysis.md`,
`risk-analysis.md`, `database-query-review.md`, and
`web-impact-review.md`. **This document does not implement anything** —
it sequences the work so a future implementation phase can pick it up.

Each phase is sized for a small focused PR pair. Phases are
independently shippable; the order minimizes risk and surfaces real
data points before tackling the larger lockstep changes.

---

## Phase 0 — Cleanups (API-only, low risk)

**Objective**: Remove operational debt that doesn't change behavior.

| Task | Files | Risk | Effort |
|---|---|---|---|
| Replace `console.log` with `this.logger` in `imports.service.ts` | `src/modules/imports/imports.service.ts:112, 125, 138, 141, 165, 170, 176, 178, 233, 241, 270, 328, 334` | low | S |
| Verify `@Throttle` decorator is applied on `bulk-reconcile` controller method | `src/modules/classification/classification.controller.ts` (or wherever the route is declared) | low | XS |
| Decide policy for Swagger at `/docs` in production | `src/main.ts:42-52` | low | XS — config change only |

**Validation**: API regression test pass; manual smoke test of imports
flow; verify Swagger gating against `NODE_ENV`.

**Web required?** No.

---

## Phase 1 — Dashboard trend SQL & imports parallelism (API-only)

**Objective**: Reduce P95 latency on the most-visited pages without
contract changes.

| Task | Finding | Files | Risk | Effort |
|---|---|---|---|---|
| Move per-month distinct-paid-resident count to SQL `GROUP BY` | P2.1 / Q5 | `dashboard.service.ts:84-153` | medium (correctness check needed) | M |
| Parallelize per-file dedup lookups in `imports.upload`; batch with `findMany(where: { fileHash: in })` | P3.1 / Q6 | `imports.service.ts:78-191` | low | S |
| Add retry-on-`P2002` to petty-cash create | P3.2 / R4.1 | `petty-cash.service.ts:40-79` | low | S |
| (Optional) Stream uploads to R2 instead of buffering 100MB max | R5.2 | `main.ts:25`, `imports.service.ts` | medium | M |

**Validation**:
- Snapshot dashboard `/trend` response for a real condominium with
  pre-existing data; compare before vs. after — totals must match.
- Run an import with 5 files; confirm parallel dedup paths produce the
  same result vs. sequential.

**Web required?** No. Response shapes preserved.

---

## Phase 2 — Transactions list projection + calendar range enforcement (API-only, low blast)

**Objective**: Reduce payload size on the heaviest read path; tighten
the calendar contract before traffic grows.

| Task | Finding | Files | Risk | Effort |
|---|---|---|---|---|
| Audit web to confirm `matchedCalendarEvent.resident`,
`importBatch`, `matchedRule`, `reconciledBy` are needed on each list
variant; trim to `select` projections where not | P3.3 / Q3 | `transactions.service.ts:25-191`; cross-check
`livo-clouds-web-app/src/components/transactions/*` | medium | M |
| Require `from`/`to` on calendar list; cap span at 12 months | P3.4 | `calendar.service.ts:32-71` | low (web already sends range) | S |

**Validation**:
- Diff list response between old and new; only fields the table reads
  should remain.
- Confirm calendar 400 fires when range omitted, and web continues to
  send range.

**Web required?** No new work — but cross-repo verification before
shipping.

---

## Phase 3 — Background classification (API-only)

**Objective**: Replace per-row `update` in `classifyBatch` with a
batched / queued approach.

| Task | Finding | Files | Risk | Effort |
|---|---|---|---|---|
| Group rows by identical classification payload, run `updateMany` per group | P2.2 / Q4 | `classification.service.ts:389-477` | medium (semantic correctness) | M |
| (Stretch) Move classification to a background queue; `confirm` returns immediately, status polled via existing batch detail endpoint | P2.2 | New queue module (BullMQ / Vercel Queues); `imports.service.confirm` | high | L |

**Validation**:
- Run a fresh import on a real seed; classification results must match
  the pre-change run byte-for-byte (excluding `matchedAt` timestamps).
- Throughput measurement on a 1,000-row import (before vs. after).

**Web required?** Only for the stretch goal — the web's `confirm`
response would gain a `processingStatus` field; today it inlines the
classification summary, which the queue path could not provide
synchronously.

---

## Phase 4 — Standardize pagination response shape (API+web, lockstep)

**Objective**: Make `{ data, meta }` the universal paginated shape so
later un-paginated → paginated migrations are uniform.

| Task | Finding | Files | Risk | Effort |
|---|---|---|---|---|
| Update `transactions.service.ts` to return `{ data, meta: {...} }` | R3.2 / Q2 | `transactions.service.ts:49-55, 98, 142, 189` | medium | S |
| Update `imports.service.ts` same | R3.2 / Q2 | `imports.service.ts:59` | low | S |
| Update web wrappers to read `data.meta.total` | R3.2 | `livo-clouds-web-app/src/lib/api/transactions.ts`, `imports.ts` | low | S |
| Ship API + web as a coordinated pair | — | both repos | medium (release coordination) | XS |

**Validation**:
- Integration test against a seed: list endpoints return `{ data, meta
  }`; web pages render with new shape.
- No web call paths read the old flat shape.

**Web required?** Yes — lockstep. Web wrapper changes ship with the API
change in the same release window.

---

## Phase 5 — Paginate residents, overdue, resident statement (API+web, rolling)

**Objective**: Bound payload on three of the four most-visited
high-risk endpoints. Default behavior preserved on API release so web
can migrate at its own pace.

| Task | Finding | Files | Risk | Effort |
|---|---|---|---|---|
| Add `page`, `limit`, `q`, `paymentStatus` to residents list | P1.1 | `residents.service.ts:15`, controller, DTO | medium | M |
| Add `page`, `limit`, `q`, `minDebt` to `/reports/overdue` | P1.4 | `reports.service.ts:8`, controller, DTO | medium | M |
| Add default `from`/`to` (last 12 mo) and tx pagination to resident statement | P1.3 | `collection.service.ts:35-117`, controller, DTO | medium | M |
| Surface R2 upload warnings on imports response (R5.3) | R5.3 | `imports.service.ts:177-179, 182-187` | low | S |
| Web migrates each page to send pagination + render controls | — | residents, overdue, statement pages | medium | M each |

**Validation**:
- API release passes with `limit=Infinity` (or very large default) so
  pre-migration web still works.
- Per-page web migration tested in a preview deploy.

**Web required?** Yes — rolling. API can ship first; web follows.

---

## Phase 6 — Paginate collection matrix (API+web, lockstep)

**Objective**: Bound payload on the largest per-tenant response.

| Task | Finding | Files | Risk | Effort |
|---|---|---|---|---|
| Decide pagination model for matrix: paginate by resident range (server) or virtualize (client) | P1.2 / P1.5 | architecture decision | high | M (decision) |
| Implement chosen model in API | P1.2 / P1.5 | `collection.service.ts:16`, `reports.service.ts:31` | medium | M |
| Implement matching UI in web | — | collection page, reports matrix page | medium | M |

**Validation**:
- Snapshot the full matrix before and after; reconstruct from
  paginated chunks; equality check.

**Web required?** Yes — lockstep.

---

## Phase 7 — Paginate calendar, inventory, common areas, petty-cash (API+web, rolling)

**Objective**: Close out the remaining unbounded lists.

| Task | Finding | Files | Risk | Effort |
|---|---|---|---|---|
| Paginate calendar list (now date-required) | Q1 (Phase 2 prerequisite) | `calendar.service.ts:32` | low | S |
| Paginate inventory `/common-areas` and `/inventory` | Q1 | `inventory.service.ts:12, 50` | low | S |
| Paginate `/petty-cash` | Q1 | `petty-cash.service.ts:14` | low | S |
| Web pages add pagination controls | — | calendar, inventory, petty-cash | low | S each |

**Validation**: per-page smoke tests.

**Web required?** Yes — rolling.

---

## Phase 8 — Index hardening (DB migration, deferred)

**Objective**: Add composite indexes only when measured pressure
warrants. Do not pre-emptively migrate.

| Task | Finding | Files | When | Risk |
|---|---|---|---|---|
| Add `@@index([condominiumId, createdAt])` on `AuditLog` | DB Q | `prisma/schema.prisma:647` | when log table > 1M rows | low |
| Add `@@index([condominiumId, fileHash])` on `ImportBatch` | DB Q | `prisma/schema.prisma:534` | only if dedup query shows up in slow log | low |
| Replace petty-cash folio `count+1` with a per-condominium sequence | R4.1 | new migration | when concurrent creates become real | low |

**Validation**: Postgres `EXPLAIN ANALYZE` on representative queries
before and after.

**Web required?** No.

---

## Phase ordering rationale

- **0–3** are API-only and independent. Phase 0 first because the
  cleanups make debugging the rest easier. Phase 1 and 2 produce
  measurable latency wins. Phase 3 is the largest API-only change.
- **4** sets the pagination shape that 5–7 depend on. Doing it before
  paginating residents/overdue avoids re-migrating shapes twice.
- **5** is the highest-value "make the app survive growth" phase.
- **6** is the largest UX-affecting change — defer until 5 has shipped
  and we have telemetry from the rolling migration.
- **7** mops up the long tail.
- **8** is opportunistic — only when telemetry demands it.

---

## Validation strategy (general)

For any phase that touches a query path:

1. **Snapshot test**: capture the JSON response of the endpoint
   against a representative seed before the change. After the change,
   re-capture and diff. Whitelist expected differences (timestamps,
   ordering of equal-key rows, pagination metadata).
2. **Performance probe**: measure response time at P50/P95 on a tenant
   with realistic volume (use the seed multiplier scripts).
3. **Web smoke test**: visit the affected page in a preview deploy and
   verify the table/grid renders and pagination works.
4. **Cross-repo contract check**: TypeScript types on the web side must
   accept the new response shape without `as unknown` casts.

For risk-only changes (R5.x, R4.x):

1. **Unit test for the corrected behavior** (race on petty-cash,
   warning surfaced for failed R2 upload).
2. **Manual smoke** of the affected flow.

---

## What this roadmap intentionally does NOT include

- Schema migrations beyond the optional indexes in Phase 8.
- Move to a different queue infrastructure (Phase 3 stretch is the only
  mention).
- Re-architecting the response envelope from `{ data }` to anything
  else — that contract is load-bearing (`risk-analysis.md` R3.1).
- Any change to tenant isolation, authentication, or the JWT model —
  current behavior is acceptable as-is (`risk-analysis.md` R1, R2, R6).
- Touching the classification algorithm itself (unit/name matching,
  terrace logic) — out of scope for a performance/risk review.
