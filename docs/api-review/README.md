# API Performance & Risk Review — livo-clouds-api-app

Read-only audit of the NestJS API. Produced 2026-05-13 from source
inspection at
`/Users/hiperezr/code/github/livoclouds/livo-clouds-api-app`.

**No source code, configuration, endpoint, DTO, guard, Prisma query, or
migration was modified during this review.** Findings are written down
so a future implementation phase can sequence the work; nothing here
has been applied.

---

## Purpose

The API has grown to ~106 endpoints across 17 modules. The web app at
`livo-clouds-web-app` consumes 32+ proxy routes against it. Several
list endpoints return unbounded results, a few aggregations are
performed in JavaScript, and pagination conventions are inconsistent.
This review:

1. Inventories every endpoint with risk tagging.
2. Identifies the highest-impact performance hotspots.
3. Identifies tenant-isolation, authorization, contract, and
   operational risks.
4. Audits Prisma indexes against the actual query patterns.
5. Cross-references every recommended change to the web modules it
   would affect.
6. Sequences the work into shippable phases.

---

## Scope

**In scope** (read-only):
- All 17 NestJS modules under `src/modules/`
- Controllers, services, DTOs, guards, interceptors, filters
- `prisma/schema.prisma` indexes
- Global setup: `main.ts`, `app.module.ts`, `src/common/**`
- Web integration surface: cross-referenced via reading
  `src/lib/api/*.ts` and `src/app/api/**/route.ts` in `livo-clouds-web-app`

**Explicitly NOT touched**:
- Source code, configuration, DTOs, controllers, services, guards
- Prisma schema or migrations
- Web app code or configuration
- Any commit, branch, or PR

---

## How to read this folder

| File | Read when |
|---|---|
| `endpoint-inventory.md` | You need to find an endpoint or know its risk level |
| `performance-analysis.md` | You're scoping a perf improvement |
| `risk-analysis.md` | You're reviewing security / contract / operational risks |
| `database-query-review.md` | You're touching Prisma queries or considering an index migration |
| `web-impact-review.md` | You're estimating coordination cost with the web app |
| `implementation-roadmap.md` | You're planning the next implementation phase |
| `findings-summary.html` | You want a one-page visual overview |

---

## Executive summary

**Severity counts (across all docs)**

| Severity | Count |
|---|---|
| critical | 5 — all are unbounded list endpoints (residents, collection year, collection statement, overdue, collection matrix) |
| high | 9 — classify-batch per-row update, dashboard trend in-memory aggregation, calendar list optional date range, common-areas list, inventory list, petty-cash list, resident statement size, imports upload sequential I/O, bulk reconcile rate limits |
| medium | ~12 — transactions list deep includes, dashboard KPI includes, imports upload buffering, petty-cash create race, R2 retention failures swallowed, pagination shape inconsistency, more |
| low / acceptable | rest — CRUD, auth, tenant isolation (already solid), index coverage (already comprehensive), append-only patterns |

**Top three risks to act on first**

1. **Residents list, overdue list, resident statement, collection
   matrix are unbounded.** They scale with tenant size; today acceptable
   but the next data-volume jump will hit them first. Recommended phase
   5–6.

2. **`classification.classifyBatch` runs one `UPDATE` per transaction
   inside chunks of 200.** A 1,000-row import = 1,000 round-trips.
   Bounded today by the chunk concurrency and the connection pool but
   wastes throughput. Recommended phase 3.

3. **Dashboard trend builds a `Map<month, Set<residentId>>` in JS** to
   compute per-month collection rate. Equivalent to one
   `COUNT(DISTINCT)` SQL query. Recommended phase 1 (highest visibility
   per dollar of effort).

**What is acceptable as-is and should NOT be changed without evidence**

- Tenant isolation via `CondominiumAccessGuard` — see
  `risk-analysis.md` R1, R6.
- Success/error response envelopes `{ data }` / `{ errors: [...] }` —
  web depends on these contracts.
- Prisma index coverage on hot models — already comprehensive.
- Append-only `transaction` flow.
- Soft-delete pattern across residents, calendar, users.

---

## Highest-impact recommendations

Cross-references to the per-doc detail:

| ID | Where | What | Web work |
|---|---|---|---|
| P1.1 | `performance-analysis.md` | Paginate residents list | API+web rolling |
| P1.2 | `performance-analysis.md` | Paginate collection year matrix | API+web lockstep |
| P1.3 | `performance-analysis.md` | Default date range + tx pagination on resident statement | API+web rolling |
| P1.4 | `performance-analysis.md` | Paginate `/reports/overdue` | API+web rolling |
| P1.5 | `performance-analysis.md` | Paginate `/reports/collection-matrix` | API+web lockstep |
| P2.1 | `performance-analysis.md` | SQL-aggregate per-month collection rate | API-only |
| P2.2 | `performance-analysis.md` | Batch classifyBatch updates | API-only |
| P3.1 | `performance-analysis.md` | Parallelize imports upload, stream to R2 | API-only |
| R3.2 | `risk-analysis.md` | Standardize pagination shape `{ data, meta }` | API+web lockstep |
| R5.3 | `risk-analysis.md` | Surface R2 retention failures | API+web lockstep |

See `implementation-roadmap.md` for phasing.

---

## Methodology

1. Inventoried the module tree under `src/modules/` and read each
   module's service and DTOs.
2. Read all common guards, filters, interceptors, and `main.ts` /
   `app.module.ts`.
3. Read `prisma/schema.prisma` indexes for the hot models.
4. Cross-checked every API change recommendation against the web's
   `src/lib/api/*.ts` and `src/app/api/**/route.ts` to determine
   coordinated work.
5. Every finding cites `file:line` so a reviewer can verify.
6. Findings labelled `confirmed` were grounded in code reads;
   `needs verification` is used only where the inspection was indirect.

**Limitations**
- Controllers were not exhaustively re-read; route handler list is
  inferred from service public methods and confirmed by the web's
  proxy routes. Controller-level decorators (`@Throttle`, `@Roles`)
  were spot-checked but not fully audited — flagged as `needs
  verification` where relevant (see R5.4).
- No runtime profiling or `EXPLAIN ANALYZE` was performed; all
  performance claims are based on code structure.
- No tests were run; classification correctness is assumed based on
  existing tests in the repo (`*.spec.ts` files were observed but not
  executed in this review).

---

## Conventions used across docs

- **Severity**: `critical` > `high` > `medium` > `low` > `acceptable`
- **Scope tag**: `API-only` / `API+web (rolling)` / `API+web (lockstep)`
- **Action tag**: `fix later` / `monitor` / `acceptable as-is`
- **Verification status**: `confirmed` (grounded in code) /
  `needs verification` (suspected, not fully traced)

---

## Files in this folder

```
docs/api-review/
├── README.md                  ← you are here
├── endpoint-inventory.md      ← every endpoint, risk-tagged
├── performance-analysis.md    ← P1..P4 findings with severity & scope
├── risk-analysis.md           ← R1..R6 findings with severity & action
├── database-query-review.md   ← Prisma patterns, indexes, recommendations
├── web-impact-review.md       ← cross-repo coordination matrix
├── implementation-roadmap.md  ← phased plan (no implementation)
└── findings-summary.html      ← single-page visual summary
```

---

## Status

**Phase 1 of this review (Initial Understanding)**: complete —
exploration agents inventoried 17 modules and 32 web proxy routes.

**Phase 2 (Design)**: complete — findings classified by severity,
scope, and verification status.

**Phase 3 (Documentation)**: complete — 7 markdown files + 1 HTML.

**Implementation**: **not started** — by design. This review is the
input to a future implementation phase scoped by
`implementation-roadmap.md`.
