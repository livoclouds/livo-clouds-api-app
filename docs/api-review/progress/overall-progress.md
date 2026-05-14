# API Review — Overall Implementation Progress

**Last updated**: 2026-05-13 (UTC) — Phase 8 evaluated (deferred)
**Tracking source of truth**: `docs/api-review/implementation-roadmap.md`
**Companion HTML report**: [`overall-progress.html`](./overall-progress.html)

---

## Overall roadmap status

Phases 0, 1, 2, 3, 4, 5, 6, and **7 — Paginate calendar / inventory /
common-areas / petty-cash** are **Complete**. **Phase 8 — Index
hardening** has now been **evaluated** (2026-05-13) per
`implementation-roadmap.md:179-194` and is **explicitly deferred** —
the evaluation found no measured pressure that justifies the three
candidate schema changes today. See the dedicated *Phase 8 —
Evaluation (2026-05-13)* section near the end of this document for
the per-item decision matrix, evidence inventory, and future trigger
conditions. No schema, migration, code, or web change was introduced
as part of the evaluation. Phase 7 was a **rolling** phase per
`implementation-roadmap.md:162-176`. Every remaining unbounded list
endpoint in the API now wraps its response in the standard
`{ data, meta }` envelope established in Phase 4 and accepts optional
`page` / `limit` query params validated by new DTOs
(`ListCalendarEventsDto` extended; new `ListCommonAreasDto`,
`ListInventoryItemsDto`, `ListPettyCashDto`).

Default `limit` values preserve today's behavior for every current
tenant in a single response page: **500** for `/calendar/events`
(bounded by the required `from`/`to` window already enforced in
Phase 2), **200** for `/common-areas`, **200** for `/inventory`,
**200** for `/petty-cash`. Maximum caps (`2000`, `500`, `1000`,
`1000`) cover growth headroom without exposing `Infinity`.

On the web side only the **calendar** slice had a live consumer to
coordinate. `getCalendarEvents()` now returns the
`{ data: CalendarEvent[], meta }` envelope and `CalendarEventList`
destructures `data` from the response. The other three endpoints
(`/common-areas`, `/inventory`, `/petty-cash`) have **no live web
consumer** today — the corresponding tables (`CommonAreasTable`,
`InventoryItemsTable`, `PettyCashMovementsTable`) continue to render
mock data (`MOCK_COMMON_AREAS`, `MOCK_INVENTORY_ITEMS`,
`MOCK_PETTY_CASH_MOVEMENTS`) and are not in scope here. Wiring those
tables to live API is a separate UI-modernization workstream
explicitly out of Phase 7's perf+pagination scope.

API `npm run build` + 65 unit tests pass; web `pnpm typecheck` +
`pnpm build` + 125 vitest tests pass. No schema change, no migration,
no new index, no endpoint path change, no envelope change, no
tenant-isolation or auth/role change.

**Overall implementation**: **7 of 8 roadmap phases delivered**
(Phase 8 — index hardening — **evaluated 2026-05-13 and deferred**
per roadmap line `implementation-roadmap.md:179-194` because none of
its three trigger conditions are met by the available evidence;
detailed decision matrix below). Pagination + perf scope across the
API surface is now **100% closed**, and the measurement-evidence-
required hardening phase is now **formally adjudicated** rather than
left open. Expressed two ways for clarity:

- **87.5%** of the 8 roadmap phases delivered (Phase 8 deferred).
- **100%** of the actionable, evidence-not-required phases delivered
  (Phases 0–7). Phase 8 was always conditional on measured pressure
  per the roadmap.

---

## Phase progress table

| Phase | Title                                                  | Status        |   % |
|------:|--------------------------------------------------------|---------------|----:|
| 0     | Cleanups (API-only, low risk)                          | **Complete**  | 100 |
| 1     | Dashboard trend SQL & imports parallelism              | **Complete**  | 100 |
| 2     | Transactions list projection + calendar range          | **Complete**  | 100 |
| 3     | Background classification                              | **Complete**  | 100 |
| 4     | Pagination response shape standardization              | **Complete**  | 100 |
| 5     | Paginate residents / overdue / resident statement      | **Complete** | 100 |
| 6     | Paginate collection matrix                             | **Complete** | 100 |
| 7     | Paginate calendar / inventory / common-areas / petty   | **Complete** | 100 |
| 8     | Index hardening (DB migration, deferred — **evaluated 2026-05-13**) | Deferred (evaluated) |   0 |

- **Current phase**: 8 (evaluated, deferred)
- **Completed phases**: 0, 1, 2, 3, 4, 5, 6, 7
- **Evaluated phases**: 8 (deferred — no measured pressure)
- **In-progress phase**: none
- **Pending phases**: none (Phase 8 is *deferred-with-decision*, not pending implementation)

---

## Phase 0 task breakdown

- [x] **P0.1** — Replace `console.*` with NestJS `Logger` in `src/modules/imports/imports.service.ts`
  - 13 calls replaced (12 `console.log` → `this.logger.log`, 1 `console.error` → `this.logger.error` with stack).
  - Added `Logger` to the existing `@nestjs/common` import and instantiated `private readonly logger = new Logger(ImportsService.name)`.
  - Redundant `[ImportsService]` message prefix dropped (Nest's `Logger` adds the context automatically).
- [x] **P0.2** — Verified `@Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 20, ttl: 60_000 } })` is applied on `POST transactions/bulk-reconcile` at `src/modules/classification/classification.controller.ts:146-150`. **No code change required.**
- [x] **P0.3** — Wrapped the Swagger registration block in `src/main.ts` behind `if (process.env.NODE_ENV !== 'production')`. In production, `/docs` now returns 404; dev/staging/testing behavior is unchanged.

---

## Phase 1 task breakdown

- [x] **P1.A** — Per-month distinct-paid-resident count moved to SQL `GROUP BY` in `src/modules/dashboard/dashboard.service.ts:87-118`.
  - Added `Prisma` import and `PAID_STATUSES = ['PAID_ON_TIME', 'PAID_LATE', 'PARTIAL']` constant.
  - Replaced the third `Promise.all` element (`collectionRecord.findMany`) with a typed `$queryRaw<{ month, paidCount }[]>` returning `COUNT(DISTINCT "residentId")` grouped by month.
  - Replaced `paidByMonth: Map<number, Set<string>>` with `Map<number, number>`; `getCollectionRate(m)` now reads the precomputed count.
  - Used quoted camelCase column names (`"condominiumId"`, `"residentId"`, `"status"`, `"year"`, `"month"`) because the actual DB columns are camelCase identifiers (confirmed via `prisma/migrations/20260509080015_initial_migration/migration.sql`).
  - `status::text IN (...)` casts the Postgres enum to text and uses `Prisma.join(...)` for safe parameterized binding.
  - Response shape preserved: `[{ month, income, expenses, collectionRate }, …]` for all 12 months.
- [x] **P1.B** — Per-file dedup lookups in `src/modules/imports/imports.service.ts upload()` are now batched into one `findMany`.
  - Refactored `upload()` into 3 passes: (1) validate MIME/size and pre-compute SHA-256 per file; (2) one batched `findMany({ where: { condominiumId, fileHash: { in: [...] } } })` over all eligible hashes; (3) sequential processing using a `dedupByHash` map that is mutated after each new `create` so the "same hash twice in one call" edge case is preserved exactly.
  - Kept `condominiumId` in the `where` clause (the roadmap snippet showed `fileHash: in` only; dropping `condominiumId` would risk cross-tenant collisions).
  - Added `include: { _count: { select: { transactions: true } } }` to the `create` so the new batch fits the same `BatchWithCount` type stored in `dedupByHash`.
  - Response shape preserved: positional array of `{ fileName, status, message, batchId?, existingBatchId? }` entries.
- [x] **P1.C** — Bounded retry-on-`P2002` in `src/modules/petty-cash/petty-cash.service.ts create()`.
  - Added `ConflictException` to `@nestjs/common` imports.
  - Added `Prisma` import from `@prisma/client` for the typed error guard.
  - Added module-level constant `MAX_FOLIO_RETRIES = 5`.
  - Wrapped `count + folio + create` in a `for` loop. Folio is `PC-${(count + 1 + attempt).padStart(4, '0')}` so each retry tries a new folio without re-reading the count optimistically.
  - On `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` and `meta.target` containing `'folio'`, the loop retries; any other error is rethrown unchanged.
  - After 5 exhausted attempts, throws `ConflictException('Could not generate unique folio after retries')` → HTTP 409 (replaces today's bare HTTP 500).
- [⏸] **P1.D** — **Deferred by user decision** — streaming uploads to R2 (`main.ts:25`, `imports.service.ts`). Optional in roadmap, risk-rated medium. Recommendation: schedule as a standalone PR with its own snapshot + load test.

---

## Files reviewed (Phase 0)

- `docs/api-review/implementation-roadmap.md`
- `docs/api-review/risk-analysis.md`
- `docs/api-review/performance-analysis.md`
- `docs/api-review/web-impact-review.md`
- `src/modules/imports/imports.service.ts`
- `src/modules/classification/classification.controller.ts`
- `src/main.ts`

## Files modified (Phase 0)

| File | Change |
|---|---|
| `src/modules/imports/imports.service.ts` | Replaced 13 `console.*` calls with NestJS `Logger`. Added `Logger` import. Added `private readonly logger = new Logger(ImportsService.name)`. |
| `src/main.ts` | Wrapped Swagger registration in `NODE_ENV !== 'production'` guard. |

**New files (progress tracking only — non-runtime):**

| File | Purpose |
|---|---|
| `docs/api-review/progress/overall-progress.md` | This file — central progress tracker across all phases. |
| `docs/api-review/progress/overall-progress.html` | Visual companion. Standalone, no JS, no runtime deps. |

---

## Files reviewed (Phase 1)

- `docs/api-review/implementation-roadmap.md` (Phase 1 scope, lines 31–49)
- `docs/api-review/performance-analysis.md` (P2.1, P3.1, P3.2)
- `docs/api-review/database-query-review.md` (Q5, Q6)
- `docs/api-review/risk-analysis.md` (R4.1, R4.2)
- `src/modules/dashboard/dashboard.service.ts`
- `src/modules/imports/imports.service.ts`
- `src/modules/petty-cash/petty-cash.service.ts`
- `prisma/schema.prisma` (CollectionRecord, PettyCashMovement)
- `prisma/migrations/20260509080015_initial_migration/migration.sql` (column casing check)

## Files modified (Phase 1)

| File | Change |
|---|---|
| `src/modules/dashboard/dashboard.service.ts` | P1.A — Replaced JS `Map<month, Set<residentId>>` in `getMonthlyTrend` with a typed `$queryRaw` returning `COUNT(DISTINCT "residentId")` grouped by `"month"`. Added `Prisma` import and `PAID_STATUSES` constant. Response shape preserved. |
| `src/modules/imports/imports.service.ts` | P1.B — Refactored `upload()` to batch per-file dedup lookups into a single `findMany`. Added `include: { _count: ... }` to `create` so the new batch slots into the same `BatchWithCount` map type. Mutates `dedupByHash` after each create to preserve same-hash-in-same-call semantics. Response shape preserved. |
| `src/modules/petty-cash/petty-cash.service.ts` | P1.C — Wrapped folio generation + `create` in a bounded retry loop (`MAX_FOLIO_RETRIES = 5`). Recovers from Prisma `P2002` on `folio` by retrying with `count + 1 + attempt`. Throws `ConflictException` (HTTP 409) on exhaustion instead of bubbling raw 500. |
| `docs/api-review/progress/overall-progress.md` | Phase 1 status updates (kickoff + close). |
| `docs/api-review/progress/overall-progress.html` | Phase 1 status updates (kickoff + close). |

---

## Validation performed

### Phase 0

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` ran clean; TypeScript compiled. |
| `npm test` | **PASS** | 2 suites, 65 tests passed (terrace-booking-matcher + terrace-metadata.validator). |
| `npm run lint` | **FAIL (pre-existing)** | ESLint 9.39.4 expects `eslint.config.js`; repo still has legacy `.eslintrc.*` format. **Not introduced by Phase 0.** |
| `npm run test:e2e` | **SKIPPED** | `test/` folder does not exist; e2e harness not configured. |

### Phase 1

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` ran clean. New imports (`Prisma` in dashboard + petty-cash, `ConflictException`) compile. `$queryRaw` types resolve. |
| `npm test` | **PASS** | 2 suites, 65 tests passed (same as Phase 0 — none of the modified services have a unit suite yet). |
| `npm run lint` | **FAIL (pre-existing)** | Same ESLint v9 config gap as Phase 0; not introduced by Phase 1. |
| `npm run test:e2e` | **SKIPPED** | `test/` folder absent. |

**Phase 1 manual checks (all PASS)**:

- `grep -n "paidByMonth\|Set<\|COUNT(DISTINCT" src/modules/dashboard/dashboard.service.ts` → `paidByMonth` is now `Map<number, number>` (no `Set<…>` constructor); `COUNT(DISTINCT "residentId")` is in the SQL.
- `grep -n "findFirst\|findMany" src/modules/imports/imports.service.ts` → the only `findFirst` calls left are in `findOne` and `confirm` (unrelated paths); the upload-flow per-file `findFirst({ fileHash })` is gone; one new `findMany` is in `upload()` for batched dedup.
- `grep -n "P2002\|MAX_FOLIO_RETRIES\|ConflictException" src/modules/petty-cash/petty-cash.service.ts` → retry constant, P2002 guard, and 409 throw all present.
- `git status` in the API repo → exactly 5 modified files (3 src + 2 progress).
- `git status` in the web repo → no Phase-1-related changes.

---

## Risks / blockers detected

- **Pre-existing lint config issue** (ESLint v9 vs legacy `.eslintrc`). Carried over from Phase 0. Recommended to address as part of a future "repo hygiene" pass.
- **No e2e harness yet**. Manual smoke checks + build + unit tests act as the validation surface for Phase 0 and Phase 1.
- **Pre-existing bug in dashboard fallback raw query** (discovered while implementing P1.A): `dashboard.service.ts:136-146` (the `summaries.length === 0` fallback) references `condominium_id`, `transaction_date`, `flow_type` in **snake_case**, but the actual Postgres columns are camelCase identifiers (`"condominiumId"`, `"transactionDate"`, `"flowType"`). This fallback will throw a "column does not exist" error at runtime if exercised. **Out of scope for Phase 1** (the roadmap line P2.1 targeted only the `Set`→SQL conversion). Recommend a follow-up correctness fix; the path is rarely exercised because `FinancialMonthlySummary` rows typically exist for any year that has had transactions.
- **R4.2 unmitigated**: petty-cash `runningBalance` is still computed from the last row (concurrent creates can produce divergent balances). The roadmap defers this to a dedicated correctness phase; flagged here so it isn't forgotten.
- **Petty-cash parallel reads not bundled**: the perf-only suggestion to wrap the first `findFirst` + `count` reads in `Promise.all` was scoped out of Phase 1 (the roadmap title is "retry-on-P2002", not "parallelize reads"). Documented as a follow-up.

---

## Impact status

| Dimension          | Status | Detail |
|--------------------|--------|--------|
| Web app changes    | **None required** | No proxy route, page, or wrapper change. Web consumers of `/dashboard/trend`, `/imports/upload`, and `/petty-cash` see identical response shapes. |
| API contract       | **Unchanged** | Response envelopes, routes, request DTOs preserved. The only error-shape delta is petty-cash now returns HTTP 409 (`ConflictException`) on exhausted folio retries instead of bubbling raw HTTP 500 — strictly an improvement, not a contract change. Phase 0's `/docs` 404-in-prod still applies. |
| Database / Prisma  | **Unchanged** | No schema edits, no migrations, no new indexes. P1.A adds a new `$queryRaw` against the existing `collection_records` table using its existing columns. |
| Tenant isolation   | **Unchanged** | All edits keep the `condominiumId` filter intact; the P1.B batched `findMany` explicitly retains `condominiumId` in `where` (deviating from the roadmap snippet on purpose). |
| AuthN / AuthZ      | **Unchanged** | No identity-layer code touched. |

---

## Remaining work in Phase 0

**None.** Phase 0 is complete.

## Remaining work in Phase 1

**None in scope.** P1.A / P1.B / P1.C are all done. P1.D (streaming
uploads to R2) was deferred by user decision; recommend scheduling as a
separate PR with snapshot + load test. R4.2 (`runningBalance` race) and
the petty-cash `Promise.all([findFirst, count])` perf tweak are
documented in "Risks / blockers detected" as follow-ups outside Phase
1's scope.

---

## Phase 2 task breakdown

- [x] **P2.A** — Targeted trim in `src/modules/transactions/transactions.service.ts`. Removed the `matchedCalendarEvent` include from `findReconciled` only (it was the one list variant whose consumer `ImportReconciledTab` never reads the field — confirmed by cross-repo audit). `findAll`, `findUnmatched`, `findClassified` are untouched: their web consumers actively render `matchedCalendarEvent` and its nested resident. Response envelope (`{ data, total, page, limit, totalPages }`) preserved. Field was already `matchedCalendarEvent?:` (optional) in the web TypeScript type, so the now-absent field is a non-breaking shape change.
- [x] **P2.B** — New `src/modules/calendar/dto/list-calendar-events.dto.ts` with `ListCalendarEventsDto`. `from` and `to` are decorated `@IsDateString() @IsNotEmpty()` (matching the convention used by `CreateCalendarEventDto`); `type` and `status` remain `@IsOptional() @IsString()` (enum tightening deferred). `calendar.service.ts` now accepts the DTO, parses both dates once, validates `to >= from`, and rejects spans larger than 365 days with `BadRequestException`. The overlap-range Prisma filter (`startDate < to AND endDate > from`) is unchanged. `calendar.controller.ts` binds the DTO via `@Query()` so the global `ValidationPipe` (configured in `src/main.ts:34-40` with `whitelist: true, transform: true`) enforces required fields and date format. The legacy `CalendarEventQuery` interface was deleted (no other importers found via `grep -rn "CalendarEventQuery" src/`).

## Phase 2 cross-repo audit (completed during planning)

Web fields actually read by each transactions list consumer:

| Endpoint | Web component | Required relations |
|---|---|---|
| `GET /transactions` (`findAll`) | None directly identified | `resident`, `matchedCalendarEvent` — kept defensively |
| `GET /transactions/unmatched` (`findUnmatched`) | `ImportReviewTab` | `matchedCalendarEvent.{title, startDate, unitNumber, resident.firstName, resident.lastName}` |
| `GET /transactions/classified` (`findClassified`) | `ImportClassifiedTab` | `resident.{firstName, lastName}`, modal: `matchedRule.name`, `matchedCalendarEvent.{title, startDate, unitNumber, resident.firstName, resident.lastName}` |
| `GET /transactions/reconciled` (`findReconciled`) | `ImportReconciledTab` | `resident.{firstName, lastName, unitNumber}`, `reconciledBy.{firstName, lastName}`, modal: `matchedRule.name`, `importBatch.fileName`. **Never reads `matchedCalendarEvent`.** |

Calendar list audit:

- Sole caller: `CalendarEventList` (web component) at `livo-clouds-web-app/src/components/calendar/CalendarEventList/index.tsx:288`.
- Always sends both `from` and `to` (month/week/day computations).
- Max span observed: 31 days (month view). Well below the planned 365-day cap.

---

## Files reviewed (Phase 2)

- `docs/api-review/implementation-roadmap.md` (Phase 2 scope, lines 53–74)
- `docs/api-review/performance-analysis.md` (P3.3, P3.4)
- `docs/api-review/database-query-review.md` (Q3)
- `docs/api-review/risk-analysis.md` (R3.4 unbounded list responses)
- `docs/api-review/web-impact-review.md` (transactions + calendar consumer notes)
- `docs/api-review/endpoint-inventory.md` (high-risk endpoint flags)
- `src/main.ts` (global `ValidationPipe` confirmation)
- `src/modules/transactions/transactions.service.ts` (all four list methods)
- `src/modules/transactions/transactions.controller.ts`
- `src/modules/transactions/dto/list-transactions.dto.ts`
- `src/modules/calendar/calendar.service.ts`
- `src/modules/calendar/calendar.controller.ts`
- `src/modules/calendar/dto/create-calendar-event.dto.ts` (style reference for the new DTO)
- Web: `livo-clouds-web-app/src/lib/api/transactions.ts`
- Web: `livo-clouds-web-app/src/lib/api/calendar.ts`
- Web: `livo-clouds-web-app/src/components/imports/ImportReviewTab/index.tsx`
- Web: `livo-clouds-web-app/src/components/imports/ImportClassifiedTab/index.tsx`
- Web: `livo-clouds-web-app/src/components/imports/ImportReconciledTab/index.tsx`
- Web: `livo-clouds-web-app/src/components/calendar/CalendarEventList/index.tsx`
- Web: `livo-clouds-web-app/src/app/api/calendar/events/route.ts`

## Files modified (Phase 2)

| File | Change |
|---|---|
| `src/modules/transactions/transactions.service.ts` | P2.A — Removed the `matchedCalendarEvent` include block from `findReconciled` only. `findAll`, `findUnmatched`, `findClassified` untouched. Response envelope preserved. |
| `src/modules/calendar/dto/list-calendar-events.dto.ts` | **NEW** — P2.B class-validator DTO: `from`/`to` `@IsDateString() @IsNotEmpty()`; `type`/`status` `@IsOptional() @IsString()`. Swagger decorators included. |
| `src/modules/calendar/calendar.service.ts` | P2.B — Removed `export interface CalendarEventQuery`. `findAll` now accepts `ListCalendarEventsDto`. Added `MAX_CALENDAR_RANGE_MS = 365 days`. Added `to >= from` and span guards; both throw `BadRequestException`. Simplified the overlap filter (always present now that range is required). Include block and `orderBy` unchanged. |
| `src/modules/calendar/calendar.controller.ts` | P2.B — Replaced `CalendarEventQuery` import with `ListCalendarEventsDto`. `@Query()` binds the new DTO so the global `ValidationPipe` enforces required + format. |
| `docs/api-review/progress/overall-progress.md` | Phase 2 status (kickoff + close). |
| `docs/api-review/progress/overall-progress.html` | Phase 2 status (kickoff + close). |

---

## Validation performed — Phase 2

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` clean. New DTO class-validator imports + `MAX_CALENDAR_RANGE_MS` compile; the changed `findAll` signature checks against the new DTO type. |
| `npm test` | **PASS** | 2 suites, 65 tests passed — same baseline as Phase 0/1 (modified services have no dedicated unit suite yet). |
| `npm run lint` | **FAIL (pre-existing)** | Same ESLint v9 config gap documented since Phase 0; not introduced by Phase 2. |
| `npm run test:e2e` | **SKIPPED** | `test/` folder still absent; e2e harness not configured. |

**Phase 2 manual checks (all PASS)**:

- `grep -c "matchedCalendarEvent" src/modules/transactions/transactions.service.ts` → 3 occurrences (`findAll` line 35, `findUnmatched` line 84, `findClassified` line 128). Was 4 before; `findReconciled` no longer includes the relation. ✓
- `grep -rn "interface CalendarEventQuery\|CalendarEventQuery " src/ --include="*.ts"` → no hits. The legacy interface is gone and nothing references it. ✓
- `grep -n "ListCalendarEventsDto\|MAX_CALENDAR_RANGE_MS" src/modules/calendar/` → DTO class declared in `dto/list-calendar-events.dto.ts:4`; imported in `calendar.controller.ts:20` and `calendar.service.ts:11`; span constant in `calendar.service.ts:19`; span check in `calendar.service.ts:51`. ✓
- `git status` in the API repo → exactly 6 changed files (3 src edits + 1 new DTO + 2 progress). ✓
- `git status` in the web repo → no Phase-2-related changes. ✓

**Response-shape probes (TODO — require a live tenant)**:

- `GET /condominiums/:slug/transactions/reconciled` → rows no longer carry `matchedCalendarEvent`; web consumer (`ImportReconciledTab`) doesn't read it, so no UI regression expected.
- `GET /condominiums/:slug/calendar/events` (no params) → `400 Bad Request` from `ValidationPipe` because `from`/`to` are missing.
- `GET /condominiums/:slug/calendar/events?from=...&to=...` (30-day range) → same response as before.
- `GET /condominiums/:slug/calendar/events` with `to - from > 365 days` → `400 Bad Request` from the service guard.

---

## Risks / blockers detected (cumulative)

Carryovers from Phase 0 and Phase 1 remain (ESLint v9 config gap, missing e2e harness, dashboard snake_case fallback bug, R4.2 `runningBalance` race, petty-cash parallel reads opportunity). Phase 2 adds the following new follow-ups:

- **`id` field trims on inner selects (deferred)**: `resident`, `matchedRule`, `reconciledBy`, `importBatch` all still ship `id` in their `select`. The web never reads these `id`s directly, but TanStack Table or future components may use them as row keys. Net payload win is marginal; the risk is non-zero. Recommend a dedicated audit phase that verifies every table's `getRowId` config before trimming.
- **Calendar `type`/`status` enum tightening (deferred)**: the new DTO keeps `@IsString()` on both. Tightening to `@IsEnum(EventType)` / `@IsEnum(EventStatus)` would catch malformed queries earlier but is a separate hardening pass.
- **`findAll` (`GET /transactions`) defensive include**: the generic list endpoint still includes `matchedCalendarEvent` even though no web component was identified as a consumer. Kept defensively because the endpoint is public-shaped and removing the include risks future regressions; revisit when an explicit consumer is identified.
- **R3.4 closure**: with required `from`/`to` and the 365-day cap, the calendar's "unbounded list response" risk is now closed for that endpoint. Other R3.4 endpoints (`residents`, `transactions`, etc.) remain pagination-bound until Phases 4–7.

---

## Impact status (cumulative through Phase 2)

| Dimension | Status | Detail |
|---|---|---|
| Web app changes | **None required** | `ImportReconciledTab` did not read `matchedCalendarEvent`; the field's TS type is optional. `CalendarEventList` already sends `from`/`to` on every call (max observed span: 31 days, well below the 365-day cap). |
| API contract | **Tightened, not broken** | `/transactions/reconciled` rows lose an optional field (`matchedCalendarEvent`). `/calendar/events` now requires `from`/`to` (400 if missing) and rejects spans > 365 days (400). Aligned with `risk-analysis.md` R3.4 and `performance-analysis.md` P3.4. Other phases' deltas (`/docs` 404 in prod; petty-cash 409 on folio exhaustion) still apply. |
| Database / Prisma | **Unchanged** | No schema edits, no migrations, no new indexes. |
| Tenant isolation | **Unchanged** | All edits keep `condominiumId` plumbing intact. |
| AuthN / AuthZ | **Unchanged** | No identity-layer code touched. |

---

## Remaining work in Phase 2

**None.** P2.A and P2.B are both complete; deferred sub-items are documented in "Risks / blockers detected".

---

## Phase 3 task breakdown

- [x] **P3.A** — Replaced per-row `prisma.transaction.update(...)` inside `classifyBatch` with a grouped `updateMany` strategy in `src/modules/classification/classification.service.ts:433-499`.
  - Two-stage per chunk: Stage A classifies in memory via the pre-existing pure `classifyTransaction` (no DB calls); Stage B groups rows by stable-serialized `data` payload and issues one `updateMany({ where: { condominiumId, id: { in } }, data })` per group, in parallel via `Promise.all`.
  - Stable key function: `JSON.stringify(data, replacer)` with a `Prisma.Decimal` → `.toString()` replacer. All other leaves are primitives, `null`, or `Date` (handled by `Date.prototype.toJSON`). Insertion order of `data` keys is fixed by the literal so identical payloads serialize to identical strings.
  - `matchedAt` normalization: one `new Date()` captured per chunk (`nowForChunk`). Auto-matched rows in the chunk share that timestamp; rows with `matchedAt === null` stay `null`. Roadmap line 89 explicitly excludes `matchedAt` timestamps from the byte-for-byte equivalence requirement.
  - Tenant isolation preserved: every `updateMany` `where` carries `condominiumId` alongside `id: { in: ids }` (matches the `R1.3` bulk-reconcile pattern).
  - Counter logic preserved: `classified` / `needsReview` / `unmatched` are computed from the same `result.classificationStatus` and `result.residentId` values as before.
  - Type: the `data` payload uses `Prisma.TransactionUncheckedUpdateManyInput` (not `TransactionUpdateManyMutationInput`) because foreign-key scalars (`residentId`, `matchedRuleId`, `matchedCalendarEventId`) are only allowed via the unchecked variant. This matches the original `update` semantics, which accepted these FKs directly.
  - `upsertMonthlySummaries(condominiumId, batchId)` call after the loop is unchanged.
  - `reclassifyBatch`, `manualMatch`, `manualClassify`, approve / ignore / reopen / bulk-reconcile paths untouched.
- [⏸] **P3.B (stretch — deferred per user)** — Move classification to a background queue. Recorded under "Risks / future work" below.

### Equivalence achieved

| Field on `Transaction` | Result |
|---|---|
| `unitNumberDetected`, `payerNameDetected`, `paymentConcept`, `paymentPeriodYear`, `paymentPeriodMonth` | byte-for-byte equal |
| `matchSource`, `confidenceScore`, `residentId`, `classificationStatus`, `requiresReviewReason`, `matchedRuleId`, `matchedCalendarEventId` | byte-for-byte equal |
| `matchedAt` | equal up to chunk-level normalization (roadmap-permitted) |
| `reconciliationStatus` | untouched — equal |
| `ClassificationSummary` (response body) | byte-for-byte equal for `{ total, classified, needsReview, unmatched }` |
| `ImportBatch` status | owned by `imports.service.confirm` — equal |

**Equivalence validation limitation**: in this environment we don't have a seed harness that runs a 1,000-row import end-to-end through `/imports/upload` → `/imports/confirm`. Build + unit tests + static grep verifications are the validation surface. A snapshot-based pre/post equivalence test on a real condominium seed is recommended before the next production deploy that exercises imports.

---

## Files reviewed (Phase 3)

- `docs/api-review/implementation-roadmap.md` (Phase 3 scope, lines 76–96)
- `docs/api-review/performance-analysis.md` (P2.2, lines 112–127)
- `docs/api-review/database-query-review.md` (Q4, lines 238–251)
- `docs/api-review/risk-analysis.md` (R1.3, R1.4 — tenant isolation pattern)
- `docs/api-review/web-impact-review.md` (line 37 — API-only, response shape preserved)
- `src/modules/classification/classification.service.ts` (full file, `classifyBatch` + helpers)
- `src/modules/imports/imports.service.ts:372` (caller: `confirm` inlines the summary)
- `src/modules/classification/classification.controller.ts:33-45` (caller: `reclassifyBatch`)

## Files modified (Phase 3)

| File | Change |
|---|---|
| `src/modules/classification/classification.service.ts` | P3.A — Replaced per-row `Promise.all(chunk.map(update))` loop (lines 436–476 of the pre-edit file) with a two-stage flow: classify in memory, group by stable-serialized payload, run one `updateMany` per group in parallel. Added `nowForChunk` for per-chunk `matchedAt` normalization. Typed `data` as `Prisma.TransactionUncheckedUpdateManyInput`. Return shape and counters unchanged. |
| `docs/api-review/progress/overall-progress.md` | Phase 3 status updates (kickoff + close). |
| `docs/api-review/progress/overall-progress.html` | Phase 3 status updates (kickoff + close). |

---

## Validation performed — Phase 3

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` clean after a one-line type fix (`Prisma.TransactionUpdateManyMutationInput` → `Prisma.TransactionUncheckedUpdateManyInput`, required so FK scalars like `residentId` are accepted by `updateMany`). |
| `npm test` | **PASS** | 2 suites, 65 tests passed — same baseline as Phase 0/1/2 (`classifyBatch` has no dedicated unit suite yet). |
| `npm run lint` | **FAIL (pre-existing)** | Same ESLint v9 vs legacy `.eslintrc` mismatch documented since Phase 0; not introduced by Phase 3. |
| `npm run test:e2e` | **SKIPPED** | `test/` folder still absent; e2e harness not configured. |

**Phase 3 manual checks (all PASS)**:

- `grep -n "updateMany\|nowForChunk\|groups\.set\|prisma\.transaction\.update(" src/modules/classification/classification.service.ts` →
  - `nowForChunk` at line 440 (chunk-scoped timestamp).
  - `groups.set` at line 480 (payload grouping).
  - `prisma.transaction.updateMany` at line 493 (new grouped update inside `classifyBatch`) and line 510 (pre-existing `reclassifyBatch` reset — untouched).
  - `prisma.transaction.update(` remaining occurrences at lines 537, 577, 626, 782, 883, 923 — all in `manualMatch` / `manualClassify` / `approveMatch` / `ignoreMatch` / `reopenMatch` / single-row classify paths; **none inside `classifyBatch`**.
- `git status` in the API repo → exactly 3 modified files (1 src + 2 progress).
- `git status` in the web repo → no changes.

**Equivalence probe (TODO — requires a live tenant seed with imports)**:

- Run `/imports/confirm` on a 1,000-row import. Capture the `classification` summary; query the resulting `transaction` rows; diff every column except `matchedAt`. Expected: identical to a pre-change baseline. Recommend doing this before the next production deploy that exercises imports.

---

## Risks / blockers detected (cumulative)

Carryovers from Phase 0/1/2 remain (ESLint v9 config gap, missing e2e harness, dashboard snake_case fallback bug at `dashboard.service.ts:136-146`, R4.2 `runningBalance` race, petty-cash `Promise.all([findFirst, count])` opportunity, deferred `id`-field trims on inner selects, deferred calendar enum tightening, `findAll` defensive include). Phase 3 adds the following:

- **P3.B stretch deferred (queue-based classification)**: Documented as future work. Would gain a `processingStatus` field on `POST /imports/confirm` and force an API+web lockstep migration per `web-impact-review.md:37`. Pre-requisites: BullMQ or Vercel Queues dependency; worker module; web polling UX; idempotency on retried jobs; observability for stuck batches. **Recommendation**: defer until telemetry shows P95 of `/imports/confirm` is unacceptable. Schedule as a dedicated phase with its own coordination plan.
- **Live-seed equivalence test not executed in this session**: build + unit tests + greps pass, but a snapshot diff of `classifyBatch` output on a real 1,000-row import was not run in this environment. Documented above; recommended before the next imports-bearing prod deploy.
- **Payload key collisions**: theoretical only — two different `Prisma.Decimal` instances representing the same value (`new Prisma.Decimal('0.9500')` vs `new Prisma.Decimal('0.95')`) serialize to the same string via `.toString()`. In `classifyBatch` `confidenceScore` is always constructed via `.toFixed(4)` so the textual form is canonical. No mitigation needed.

---

## Impact status (cumulative through Phase 3)

| Dimension | Status | Detail |
|---|---|---|
| Web app changes | **None required** | `POST /imports/confirm` still returns the inline `ClassificationSummary` (`{ total, classified, needsReview, unmatched }`). `POST /transactions/imports/:batchId/classify` (`reclassifyBatch`) likewise unchanged. The web wrapper at `livo-clouds-web-app/src/lib/api/imports.ts` consumes the same shape. |
| API contract | **Unchanged** | Endpoint paths preserved. Response envelopes preserved. Error envelopes preserved. No new DTO. The only behavioral delta is internal: `matchedAt` is now uniform per chunk for auto-matched rows in a single `classifyBatch` run, an explicitly roadmap-permitted change. Earlier-phase deltas (`/docs` 404 in prod, petty-cash 409 on folio exhaustion, calendar `from`/`to` required + 365-day cap, `findReconciled` no longer ships `matchedCalendarEvent`) still apply. |
| Database / Prisma | **Unchanged** | No schema edits, no migrations, no new indexes. The existing index `@@index([condominiumId])` on `Transaction` (and the `id` PK) already supports the new `updateMany` `where: { condominiumId, id: { in: [...] } }`. |
| Tenant isolation | **Unchanged** | The new `updateMany` `where` keeps `condominiumId` next to `id: { in: [...] }` — same defense-in-depth pattern as `R1.3` bulk-reconcile. No cross-tenant update path was introduced. |
| AuthN / AuthZ | **Unchanged** | No identity-layer code touched. |
| Audit behavior | **Unchanged** | `classifyBatch` writes no audit log inside the loop (and didn't before). Audit writes for approve/ignore/reopen/bulk-reconcile (in other methods) are unchanged. |

---

## Remaining work in Phase 3

**None.** P3.A is complete. P3.B (queue-based classification) is documented as deferred future work per user instruction.

---

## Phase 4 task breakdown

- [x] **P4.A** — Standardized paginated response shape on **transactions** list endpoints. `src/modules/transactions/transactions.service.ts` `findAll` (line 49), `findUnmatched` (line 100), `findClassified` (line 152), `findReconciled` (line 198) now return `{ data, meta: { total, page, limit, totalPages } }`. Controllers untouched (pure pass-through; no `@ApiResponse` decorators to update). Includes (`resident`, `matchedCalendarEvent`, `importBatch`, `matchedRule`, `reconciledBy`, `_count`) and `where` clauses preserved.
- [x] **P4.B** — Standardized paginated response shape on **imports** list endpoint. `src/modules/imports/imports.service.ts` `findAll` (line 62) now returns the same nested shape. Controller untouched. Filter logic preserved.
- [x] **P4.C** — Updated web type interfaces in lockstep. `livo-clouds-web-app/src/lib/api/transactions.ts:68-76` (`PaginatedTransactions`) and `imports.ts:34-42` (`PaginatedImportBatches`) replaced flat fields with `meta: { total, page, limit, totalPages }`.
- [x] **P4.D** — Updated all 8 consumer access sites in lockstep. `ImportHistoryTab/index.tsx:145-146`, `ImportReviewTab/index.tsx:274,277`, `ImportClassifiedTab/index.tsx:279-280`, `ImportReconciledTab/index.tsx:154-155` now read `data.meta?.total` / `data.meta?.totalPages` (optional-chain kept defensively, matching the pre-existing `?? 0` / `?? 1` style — would only fire on a malformed server body).

### What this change means for the wire

Final HTTP body of `GET /condominiums/:slug/transactions` (and the unmatched/classified/reconciled variants) and `GET /condominiums/:slug/imports/batches` is now (after the global `ResponseInterceptor` at `src/common/interceptors/response.interceptor.ts:11-17`):

```json
{ "data": { "data": [ ... ], "meta": { "total": 123, "page": 1, "limit": 50, "totalPages": 3 } } }
```

The outer `{ data }` envelope is the global interceptor (unchanged); the inner shape is the new standardized pagination payload. The web `lib/api/client.ts:63` strips the outer envelope before returning, so wrappers and proxy routes see `{ data: [...], meta: {...} }` directly.

### Out-of-scope flat endpoints — documented as follow-up

- `src/modules/reconciliation-rules/reconciliation-rules.service.ts:12-37` `findAll` — still flat. **Not listed in roadmap Phase 4.** Recommended for inclusion when a later phase (5+) extends the standardization pass.
- All other paginated endpoints (residents, calendar, inventory, petty-cash, common-areas) are pending Phases 5–7 per the roadmap.

---

## Files reviewed (Phase 4)

- `docs/api-review/implementation-roadmap.md` (Phase 4 scope, lines 99-118)
- `docs/api-review/risk-analysis.md` (R3.2 — pagination shape inconsistency)
- `docs/api-review/database-query-review.md` (Q2 — paginated endpoints)
- `docs/api-review/web-impact-review.md` (lockstep pair requirement, line 37)
- `docs/api-review/performance-analysis.md` (cross-reference for paginated list endpoints)
- `docs/api-review/endpoint-inventory.md` (cross-reference for paginated list endpoints)
- `src/common/interceptors/response.interceptor.ts` (global success envelope)
- `src/common/types/index.ts` (existing `PaginatedResult<T>` shape at lines 28-36 — reused as the target shape; not imported to keep edits minimal)
- `src/modules/transactions/transactions.service.ts` (4 paginated methods)
- `src/modules/transactions/transactions.controller.ts` (confirmed pass-through, no decorator changes)
- `src/modules/imports/imports.service.ts` (paginated `findAll`)
- `src/modules/imports/imports.controller.ts` (confirmed pass-through)
- `src/modules/audit/audit.service.ts` (cross-reference — already uses nested `meta`)
- `src/modules/reconciliation-rules/reconciliation-rules.service.ts` (cross-reference — flat, but out of Phase 4 scope)
- Web: `src/lib/api/client.ts` (envelope unwrap at line 63)
- Web: `src/lib/api/transactions.ts` (paginated wrappers + interface)
- Web: `src/lib/api/imports.ts` (paginated wrapper + interface)
- Web: `src/app/api/transactions/route.ts`, `transactions/classified/route.ts`, `transactions/reconciled/route.ts`, `imports/batches/route.ts` (confirmed pass-through — no edit needed)
- Web: `src/components/imports/ImportHistoryTab/index.tsx`
- Web: `src/components/imports/ImportReviewTab/index.tsx`
- Web: `src/components/imports/ImportClassifiedTab/index.tsx`
- Web: `src/components/imports/ImportReconciledTab/index.tsx`
- Web: `src/components/ui/table-pagination.tsx` (confirmed prop-only — no edit needed)
- Web: `src/types/reconciliation.types.ts` (cross-reference — `PaginatedReconciliationRules` flat, untouched)

## Files modified (Phase 4)

| File | Change |
|---|---|
| `src/modules/transactions/transactions.service.ts` | P4.A — Rewrote terminal return statements in `findAll`, `findUnmatched`, `findClassified`, `findReconciled` from flat `{ data, total, page, limit, totalPages }` to nested `{ data, meta: { total, page, limit, totalPages } }`. No other edits. |
| `src/modules/imports/imports.service.ts` | P4.B — Same rewrite on `findAll` only. No other edits. |
| `livo-clouds-web-app/src/lib/api/transactions.ts` | P4.C — `PaginatedTransactions` interface: flat → nested `meta`. |
| `livo-clouds-web-app/src/lib/api/imports.ts` | P4.C — `PaginatedImportBatches` interface: flat → nested `meta`. |
| `livo-clouds-web-app/src/components/imports/ImportHistoryTab/index.tsx` | P4.D — `data.total` → `data.meta?.total`, `data.totalPages` → `data.meta?.totalPages`. |
| `livo-clouds-web-app/src/components/imports/ImportReviewTab/index.tsx` | P4.D — same rewrite (pendingTotal access + setTotalPages). |
| `livo-clouds-web-app/src/components/imports/ImportClassifiedTab/index.tsx` | P4.D — same. |
| `livo-clouds-web-app/src/components/imports/ImportReconciledTab/index.tsx` | P4.D — same. |
| `docs/api-review/progress/overall-progress.md` | Phase 4 status updates (kickoff + close). |
| `docs/api-review/progress/overall-progress.html` | Phase 4 status updates (kickoff + close). |

---

## Validation performed — Phase 4

### API repo

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` clean. Inner-shape change compiles; service return-type inference resolves cleanly through the controllers. |
| `npm test` | **PASS** | 2 suites, 65 tests passed — same baseline as Phase 0/1/2/3 (no pagination assertions in any unit suite, so no test churn). |
| `npm run lint` | **FAIL (pre-existing)** | Same ESLint v9 vs legacy `.eslintrc` mismatch documented since Phase 0; not introduced by Phase 4. |
| `npm run test:e2e` | **SKIPPED** | `test/` folder still absent; e2e harness not configured. |

### Web repo

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | **PASS** | `tsc --noEmit` clean. The interface change propagates through `apiRequest<T>`, the 4 Next.js proxy routes (which type-ripple automatically since they call `apiRequest<PaginatedX>(...)` without destructuring), and the 4 consumer components. |
| `pnpm build` | **PASS** | `next build` succeeded; all routes and API proxies compiled. |
| `pnpm test` | **PASS** | 6 vitest suites, 125 tests passed (calendar utilities, format-currency, terrace-booking). No test asserts pagination shape. |
| `pnpm lint` | **NOT RUN** | Not exercised in this phase; lint state is unrelated to Phase 4. |
| `pnpm test:e2e` | **NONE** | No e2e script configured. |

### Manual checks (all PASS)

- `grep -n "data, total, page, limit, totalPages" src/modules/transactions/transactions.service.ts src/modules/imports/imports.service.ts` → **0 hits** (was 5 before). ✓
- `grep -n "meta:" src/modules/transactions/transactions.service.ts src/modules/imports/imports.service.ts` → **5 hits** (4 transactions + 1 imports) — exactly the count expected. ✓
- `grep -rn "\.total\b\|\.totalPages" livo-clouds-web-app/src/components/imports/ src/lib/api/transactions.ts src/lib/api/imports.ts` → only `.meta?.total` / `.meta?.totalPages` access in the 4 tabs; flat accesses are gone. ✓
- `git status` in API repo → exactly 4 modified files (2 src + 2 progress).
- `git status` in web repo → exactly 6 modified files (2 lib/api + 4 components).

---

## Risks / blockers detected (cumulative)

Carryovers from Phase 0/1/2/3 remain (ESLint v9 config gap, missing e2e harness, dashboard snake_case fallback bug at `dashboard.service.ts:136-146`, R4.2 `runningBalance` race, petty-cash parallel reads opportunity, deferred `id` trims on inner selects, deferred calendar enum tightening, generic `findAll` defensive include, P3.B queue-based classification stretch, live-seed equivalence test for `classifyBatch`). Phase 4 adds:

- **External API consumers — confirmed none in this monorepo**. The Phase 4 change is a breaking shape change on the wire (flat → nested `meta`). It is safe **only** because the API is consumed exclusively by this web app, validated in the same session. If a future client (mobile, partner, third-party) is added that reads paginated `transactions` or `imports` responses, it must adopt the nested shape — flag in any future external-integration design doc.
- **Out-of-scope `reconciliation-rules` flat endpoint**: still returns flat fields. Web reads `data.total` directly in `ReconciliationRulesSection` (`livo-clouds-web-app/src/components/settings/ReconciliationRulesSection/index.tsx:243`). **Not a Phase 4 concern** — roadmap reserves it for later. Document so it isn't forgotten when Phase 5+ work expands the standardization pass.
- **Defensive optional-chaining (`data.meta?.total`)**: kept on the web side to match the pre-existing `?? 0` / `?? 1` style. With the new strict `meta: {...}` interface the chain is technically unreachable, but it harmlessly preserves defensive behavior if the server returns a malformed body.

---

## Impact status (cumulative through Phase 4)

| Dimension | Status | Detail |
|---|---|---|
| Web app changes | **Required and completed** | 2 type interfaces + 4 consumer tabs updated in the same window as the API change. Next.js proxy routes pass through unchanged (typed via `apiRequest<PaginatedX>` so the ripple is automatic). `TablePagination` UI component is shape-agnostic — no edit needed. |
| API contract | **Changed — paginated transactions + imports** | Wire shape: `GET /transactions[/unmatched|/classified|/reconciled]` and `GET /imports/batches` now return nested `meta` inside the global success envelope. All other endpoints unchanged. Endpoint paths preserved. Error envelopes preserved. Earlier-phase deltas (`/docs` 404 in prod, petty-cash 409 on folio exhaustion, calendar `from`/`to` required + 365-day cap, `findReconciled` no longer ships `matchedCalendarEvent`, classifyBatch chunk-uniform `matchedAt`) still apply. |
| Database / Prisma | **Unchanged** | No schema edits, no migrations, no new indexes, no query changes — purely an in-memory return-statement rewrite. |
| Tenant isolation | **Unchanged** | No `where` clauses touched. The `condominiumId` filter remains on every list query. |
| AuthN / AuthZ | **Unchanged** | No identity-layer code touched. |
| Audit behavior | **Unchanged** | List endpoints write no audit logs (and didn't before). |

---

## Remaining work in Phase 4

**None.** P4.A, P4.B, P4.C, P4.D are all complete. The out-of-scope flat endpoint (`reconciliation-rules`) is documented as a follow-up.

---

## Phase 5 task breakdown

- [x] **P5.A** — Residents list pagination + filters. New
  `src/modules/residents/dto/list-residents.dto.ts`
  (`ListResidentsDto`) with `page` (≥1, default 1), `limit` (1–500,
  default 500), `q` (max 100 chars), `paymentStatus` (Prisma
  `PaymentStatus` enum — `CURRENT` / `OVERDUE`).
  `src/modules/residents/residents.service.ts` `findAll(condominiumId,
  dto)` now builds a `Prisma.ResidentWhereInput` with
  `condominiumId` + `deletedAt: null` + optional `paymentStatus` +
  optional case-insensitive `OR: [unitNumber, firstName, lastName]
  contains q`, runs `Promise.all([findMany({ skip, take, where,
  include, orderBy }), count({ where })])`, and returns
  `PaginatedResult<Resident>`. `vehicles`/`pets`/`additionalResidents`
  include preserved; `orderBy unitNumber asc` preserved.
  `src/modules/residents/residents.controller.ts` `@Get()` binds
  `@Query() dto`.
- [x] **P5.B** — Overdue report pagination + filters. New
  `src/modules/reports/dto/list-overdue.dto.ts` (`ListOverdueDto`)
  with `page`, `limit` (max 500), `q`, `minDebt` (≥0).
  `src/modules/reports/reports.service.ts` `getOverdue(condominiumId,
  dto)` keeps the hard-coded `paymentStatus: 'OVERDUE'` filter, adds
  optional `q`-on-unit/firstName/lastName and `debt: { gte: minDebt
  }`, then `Promise.all([findMany, count])`. JS `.map()` reshape runs
  only on the current page so `overdueMonths = r.collectionRecords.length`
  per-row stays bounded. Returns `PaginatedResult<OverdueResident>`.
  Controller binds `@Query() dto`.
- [x] **P5.C** — Resident account statement defaults + transaction
  pagination + aggregate `totalPaid`. New
  `src/modules/collection/dto/account-statement.dto.ts`
  (`AccountStatementDto`) with `from?` / `to?` (`@IsDateString()`), `year?`,
  `month?`, `txPage? = 1`, `txLimit? = 200` (max 200).
  `src/modules/collection/collection.service.ts`
  `getAccountStatement(condominiumId, residentId, dto)`: when both
  `from` and `to` are absent, computes `to = new Date()` and `fromDate
  = to − 12 months`. Builds typed `Prisma.TransactionWhereInput` and
  `Prisma.CollectionRecordWhereInput`. Runs **4 parallel queries**:
  `transaction.findMany({ ..., skip, take })`, `transaction.count({
  where })`, `transaction.aggregate({ ..., flowType: 'INCOME', _sum: {
  credits: true } })`, `collectionRecord.findMany`. `summary.totalPaid`
  comes from `incomeAgg._sum.credits` (covers the whole filtered
  window, not just the current page).
  Response shape: `{ resident, transactions: { data, meta },
  collectionRecords, summary }`. `resident`, `collectionRecords`, and
  `summary` field set unchanged. Controller binds the DTO via
  `@Query()`.
- [x] **P5.D** — Imports upload R2 warnings.
  `src/modules/imports/imports.service.ts` `upload()` now declares a
  per-file `warnings: string[]`. The R2 catch block pushes
  `'storage.retentionFailed'` into `warnings`; the final per-file
  result spreads `...(warnings.length > 0 ? { warnings } : {})` so the
  field is omitted on the wire when empty. `status: 'queued'` is
  preserved; flow control is unchanged. The pre-existing
  `file.warnings` in the `confirm` flow (lines 335/354) writes
  parser-emitted warnings to `ImportBatch.warnings` and is untouched.
- [x] **P5.E (web)** — Wrappers updated for the new shape.
  `src/lib/api/residents.ts`: new
  `PaginatedResidentsResponse` / `ResidentsListMeta` /
  `GetResidentsParams` types; `getResidents(params?)` builds a query
  string and reads `body.data` / `body.meta`. `ResidentsPageData`
  gains `meta?`.
  `src/lib/api/reports.ts`: new `PaginationMeta` /
  `OverdueReportResponse` / `OverdueReportParams`;
  `fetchOverdueReport(slug, token, params?)` returns the envelope.
  `src/lib/api/collection.ts`: new `AccountStatementTransaction` /
  `AccountStatementTxMeta`; `AccountStatement.transactions` is now `{
  data, meta }`; `fetchResidentAccountStatement` accepts optional
  `txPage` / `txLimit`.
- [x] **P5.F (web)** — Residents proxy forwards search params.
  `src/app/api/residents/route.ts` now takes a `NextRequest`, copies
  `page` / `limit` / `q` / `paymentStatus` from
  `request.nextUrl.searchParams` into the upstream URL.
- [x] **P5.G (web)** — Upload UI warning chip + i18n. The fire-and-forget
  upload call in
  `src/components/imports/ImportDataModule/index.tsx` is now a
  `.then(...).catch(...)` that reads per-file `warnings` from the
  upload response, maps them onto the matching queue entry by
  `fileName`, and fires a `toast.warning(...)` for
  `storage.retentionFailed`. `src/components/imports/FileQueueItem/index.tsx`
  imports `AlertTriangle` and renders an amber chip below the status
  badge whenever `entry.warnings?.length`. `ClientFileEntry` gains an
  optional `warnings?: string[]` field. EN/ES translation keys added
  under `imports.upload.warnings.storageRetentionFailed` (+
  `…Title`).

### Wire shape change (per endpoint)

| Endpoint | Old shape | New shape |
|---|---|---|
| `GET /condominiums/:slug/residents` | `Resident[]` | `{ data: Resident[], meta: { total, page, limit, totalPages } }` |
| `GET /condominiums/:slug/reports/overdue` | `OverdueResident[]` | `{ data: OverdueResident[], meta: { total, page, limit, totalPages } }` |
| `GET /condominiums/:slug/collection/residents/:residentId/account-statement` | `{ resident, transactions: Tx[], collectionRecords, summary }` | `{ resident, transactions: { data: Tx[], meta: { total, page, limit, totalPages } }, collectionRecords, summary }` |
| `POST /condominiums/:slug/imports/upload` (per-file) | `{ fileName, status, message, batchId?, existingBatchId? }` | `{ fileName, status, message, batchId?, existingBatchId?, warnings?: string[] }` |

(All four are still wrapped by the global `{ data: ... }` envelope from `ResponseInterceptor`.)

### Out-of-scope flat endpoints — still pending later phases

- `src/modules/reconciliation-rules/reconciliation-rules.service.ts:12-37`
  `findAll` — flat. Pending Phase 7 sweep.
- `collection year matrix` (`P1.2`/`P1.5`) — Phase 6 (lockstep).
- Calendar / inventory / common-areas / petty-cash — Phase 7.

---

## Files reviewed (Phase 5)

- `docs/api-review/implementation-roadmap.md` (Phase 5 scope, lines 121–141)
- `docs/api-review/performance-analysis.md` (P1.1, P1.3, P1.4)
- `docs/api-review/risk-analysis.md` (R5.3 — R2 upload swallowing)
- `docs/api-review/web-impact-review.md` (rolling-coordination rows for residents / overdue / statement / upload UI)
- `docs/api-review/database-query-review.md` (Q1, Q2)
- `src/common/types/index.ts` (`PaginatedResult<T>` target shape)
- `src/modules/residents/residents.{service,controller}.ts` + `dto/`
- `src/modules/reports/reports.{service,controller}.ts`
- `src/modules/collection/collection.{service,controller}.ts`
- `src/modules/imports/imports.service.ts` (`upload` flow + `confirm` to confirm `warnings` semantics differ)
- `prisma/schema.prisma` (`PaymentStatus` enum, `Resident.debt` column type, `Transaction` shape)
- Web: `src/lib/api/{residents,reports,collection}.ts`
- Web: `src/app/api/residents/route.ts`, `src/app/api/imports/upload/route.ts`
- Web: `src/components/imports/{ImportDataModule,FileQueueItem,UploadDropzone}/index.tsx`
- Web: `src/types/import.types.ts`
- Web: `messages/{en,es}/imports.json`
- Web: `src/components/residents/ResidentsTable/index.tsx` (verified — keeps client-side filter/pagination; no refactor required)

## Files modified (Phase 5)

| File | Change |
|---|---|
| **NEW** `src/modules/residents/dto/list-residents.dto.ts` | `ListResidentsDto` — `page`, `limit` (max 500), `q` (max 100), `paymentStatus` (Prisma enum). |
| `src/modules/residents/residents.service.ts` | `findAll(condominiumId, dto)` paginates with `Promise.all([findMany, count])`. Returns `PaginatedResult<Resident>`. |
| `src/modules/residents/residents.controller.ts` | `@Get()` binds `@Query() dto: ListResidentsDto`. `Query` imported from `@nestjs/common`. |
| **NEW** `src/modules/reports/dto/list-overdue.dto.ts` | `ListOverdueDto` — `page`, `limit` (max 500), `q` (max 100), `minDebt` (≥0). |
| `src/modules/reports/reports.service.ts` | `getOverdue(condominiumId, dto)` paginates with `Promise.all`. Adds `q` `OR`-on-unit/firstName/lastName and `debt: { gte: minDebt }`. `.map()` reshape runs on the page only. Returns `PaginatedResult<OverdueResident>`. |
| `src/modules/reports/reports.controller.ts` | `@Get('overdue')` binds `@Query() dto: ListOverdueDto`. |
| **NEW** `src/modules/collection/dto/account-statement.dto.ts` | `AccountStatementDto` — `from?`, `to?`, `year?`, `month?` (1–12), `txPage? = 1`, `txLimit? = 200`. |
| `src/modules/collection/collection.service.ts` | `getAccountStatement(condominiumId, residentId, dto)`: default 12-month window when `from`/`to` absent; `Promise.all([tx.findMany({ skip, take }), tx.count, tx.aggregate({ _sum: credits }), cr.findMany])`; `summary.totalPaid` from SQL `aggregate`; `transactions` is `{ data, meta }`. |
| `src/modules/collection/collection.controller.ts` | `@Query() dto: AccountStatementDto`. |
| `src/modules/imports/imports.service.ts` | `upload()` builds `warnings: string[]` per file; R2 catch pushes `'storage.retentionFailed'`; result spreads `warnings` only when non-empty. |
| `src/lib/api/residents.ts` (web) | New types (`PaginatedResidentsResponse`, `ResidentsListMeta`, `GetResidentsParams`). `getResidents(params?)` builds a query string and reads the envelope. `ResidentsPageData.meta?` added. |
| `src/lib/api/reports.ts` (web) | New types (`PaginationMeta`, `OverdueReportResponse`, `OverdueReportParams`). `fetchOverdueReport(slug, token, params?)` returns the envelope. |
| `src/lib/api/collection.ts` (web) | `AccountStatement.transactions` is `{ data, meta }`. New `AccountStatementTransaction` / `AccountStatementTxMeta`. `fetchResidentAccountStatement` accepts `txPage` / `txLimit`. |
| `src/app/api/residents/route.ts` (web) | `NextRequest` arg; copies `page` / `limit` / `q` / `paymentStatus` to upstream URL. |
| `src/components/imports/ImportDataModule/index.tsx` (web) | Reads upload response; maps `warnings` per-file by `fileName` onto queue entries; toast for `storage.retentionFailed`. |
| `src/components/imports/FileQueueItem/index.tsx` (web) | Amber `AlertTriangle` chip rendered when `entry.warnings?.length`; uses `imports.upload.warnings` namespace. |
| `src/types/import.types.ts` (web) | `ClientFileEntry` gains optional `warnings?: string[]`. |
| `messages/en/imports.json` (web) | Added `imports.upload.warnings.storageRetentionFailed{,Title}` keys. |
| `messages/es/imports.json` (web) | Added the same keys in Spanish. |
| `docs/api-review/progress/overall-progress.md` | Phase 5 status updates (kickoff + close). |
| `docs/api-review/progress/overall-progress.html` | Phase 5 status updates (kickoff + close). |

---

## Validation performed — Phase 5

### API repo

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` clean. New DTOs + `class-validator`/`class-transformer` decorators compile; service signatures and `PaginatedResult` return types resolve. |
| `npm test` | **PASS** | 2 suites, 65 unit tests — same baseline as Phase 0/1/2/3/4. No suite asserts pagination/filter shape. |
| `npm run lint` | **FAIL (pre-existing)** | Same ESLint v9 vs legacy `.eslintrc` mismatch documented since Phase 0; not introduced by Phase 5. |
| `npm run test:e2e` | **SKIPPED** | `test/` folder still absent; e2e harness not configured. |

### Web repo

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | **PASS** | `tsc --noEmit` clean. New wrapper types propagate; `ResidentsTable.getResidents()` still works without UX changes (server returns 500-row page that today fits any tenant). |
| `pnpm build` | **PASS** | `next build` clean. All routes + API proxies compile. |
| `pnpm test` | **PASS** | 6 vitest suites, 125 tests — same baseline. |

### Manual checks (all PASS)

- `grep "findMany\\|count\\|aggregate" src/modules/residents/residents.service.ts src/modules/reports/reports.service.ts src/modules/collection/collection.service.ts` → each list/statement query sits inside a `Promise.all([findMany({ skip, take, where, … }), count({ where }), …])`.
- `grep "warnings" src/modules/imports/imports.service.ts` → `warnings: string[]` is declared per file; pushed to in the R2 catch; conditionally spread on the result.
- `grep "ListResidentsDto|ListOverdueDto|AccountStatementDto" src/modules` → all three DTOs imported in both service and controller.
- `grep "body\\.data\\|body\\.meta" src/lib/api/residents.ts` → wrapper reads the new envelope.
- `grep "warnings" src/lib/api/residents.ts src/lib/api/reports.ts src/lib/api/collection.ts src/components/imports/FileQueueItem/index.tsx src/types/import.types.ts` → warning chip + type union threaded through the UI.
- `git status` (API) → 8 changed files (3 service + 3 controller + 1 imports.service + 1 progress.md, plus 3 new DTOs, plus 1 progress.html — count varies by how `git status` groups).
- `git status` (web) → 9 changed files (3 wrappers + 1 proxy + 2 components + 1 import.types + 2 i18n).

### Response-shape probes (TODO — require a live tenant)

- `GET /condominiums/:slug/residents` (no params) → returns `{ data: [...], meta: { total, page: 1, limit: 500, totalPages: 1 } }`; `ResidentsTable` renders identically.
- `GET /condominiums/:slug/residents?page=2&limit=50&q=garc&paymentStatus=OVERDUE` → paginated subset; `meta.total` reflects filtered count.
- `GET /condominiums/:slug/reports/overdue?minDebt=10000&q=303` → filtered envelope; `paymentStatus=OVERDUE` filter still applied unconditionally.
- `GET /condominiums/:slug/collection/residents/:id/account-statement` (no params) → default window = last 12 months; `transactions.meta.limit = 200`; `summary.totalPaid` from `aggregate._sum.credits`.
- `POST /condominiums/:slug/imports/upload` with R2 unreachable → each file `{ status: 'queued', warnings: ['storage.retentionFailed'], … }`; web `FileQueueItem` shows the amber chip + Sonner toast.
- `POST .../imports/upload` with R2 healthy → `warnings` absent from the wire.

---

## Risks / blockers detected (cumulative)

Carryovers from Phase 0/1/2/3/4 remain (ESLint v9 config gap, missing e2e harness, dashboard snake_case fallback bug at `dashboard.service.ts:136-146`, R4.2 `runningBalance` race, petty-cash parallel reads opportunity, deferred `id` trims on inner selects, deferred calendar enum tightening, generic `findAll` defensive include, P3.B queue-based classification stretch, live-seed equivalence test for `classifyBatch`, `reconciliation-rules` flat shape, external API consumer assumption). Phase 5 adds:

- **`ResidentsTable` still does client-side pagination**: today's UX is preserved because the API returns up to 500 residents per page (largest seed < 300). When tenants exceed 500 residents — or before any future scale-up — migrate `ResidentsTable` to server-side pagination using the `meta` already exposed on the wire and the `q` / `paymentStatus` query params already accepted upstream. **Documented as rolling follow-up.**
- **`/reports/overdue` and the resident account statement have no web consumers yet**: the wrapper types are correct, but the actual pages (`app/[locale]/(app)/overdue/page.tsx` is a placeholder; the resident statement page is not yet built). When the pages are added, they should use `txPage` / `txLimit` / `q` / `minDebt` / `from` / `to` directly.
- **Defaults are not unlimited**: `limit=500` and `txLimit=200` are not equivalent to `Infinity`. A condominium with > 500 residents OR a resident with > 200 transactions in 12 months will see paginated data on first call. If that becomes a regression for any operator before web pages migrate, raise the default in the DTO file (not in the consumer) — but do not expose `Infinity` (DoS surface).
- **Aggregate vs reduce for `totalPaid`**: behavior is intentionally identical when no rounding artifact occurs (Prisma `Decimal` → `Number()`). A future audit could compare `aggregate._sum.credits.toString()` against the JS reduce on a fixed seed; documented as a one-shot check, not a recurring risk.

---

## Impact status (cumulative through Phase 5)

| Dimension | Status | Detail |
|---|---|---|
| Web app changes | **Required and completed** | 3 wrappers + 1 proxy + 3 components + 1 type + 2 i18n files. `ResidentsTable` UX unchanged. Overdue and statement pages remain placeholders pending Phase 5 follow-ups. |
| API contract | **Changed — residents, /reports/overdue, account statement, imports/upload** | Residents and overdue now return `{ data, meta }`; account statement nests `transactions` as `{ data, meta }`; imports/upload per-file gains optional `warnings: string[]`. Earlier-phase deltas (`/docs` 404 in prod, petty-cash 409, calendar `from`/`to` required + 365-day cap, `findReconciled` no longer ships `matchedCalendarEvent`, `classifyBatch` chunk-uniform `matchedAt`, transactions/imports nested `meta`) still apply. |
| Database / Prisma | **Unchanged** | No schema edits, no migrations, no new indexes. New `where` clauses scan within `condominiumId`-indexed subsets; no full-table scans introduced. |
| Tenant isolation | **Unchanged** | `condominiumId` (from `CondominiumAccessGuard`) flows into every `where`. No tenant data accepted from query params. |
| AuthN / AuthZ | **Unchanged** | No identity-layer code touched. |
| Audit behavior | **Unchanged** | List endpoints and statement endpoint write no audit logs. |

---

## Remaining work in Phase 5

**None.** P5.A through P5.G are complete. Out-of-scope items
(`reconciliation-rules` standardization, `ResidentsTable` server-side
pagination, building the actual overdue and statement pages) are
documented under "Risks / blockers detected" as rolling follow-ups,
not Phase 5 work.

---

## Recommended next step (from Phase 5)

Phase 6 has now started — see the Phase 6 sections below for the
architecture decision, task breakdown, files modified, validation,
and matrix-equivalence proof.

---

## Phase 6 — In progress (kickoff)

### Scope (from `implementation-roadmap.md:144-158`)

Phase 6 is the **lockstep** API+web phase that bounds the largest
per-tenant response: the collection year matrix. Two related
endpoints are unbounded today:

| Endpoint | File | Symptom | Severity |
|---|---|---|---|
| `GET /condominiums/:slug/collection?year=Y` | `collection.service.ts:10-20` | `findMany({ condominiumId, year })` + nested `resident.select` — up to `residents × 12` flat rows per call (`P1.2`) | critical |
| `GET /condominiums/:slug/reports/collection-matrix?year=Y` | `reports.service.ts:72-93` | `findMany` residents + nested `collectionRecords (where: year)` — one row per resident with 12-month embedded array (`P1.5`) | critical |

### Phase 6 task breakdown

- [⏳] **P6.A** — Update progress files (kickoff).
- [ ] **P6.B** — Document architecture decision (Options A/B/C; pick A).
- [ ] **P6.C** — API: paginate `/collection` (`ListCollectionDto`, `collection.service.findAll`, controller).
- [ ] **P6.D** — API: paginate `/reports/collection-matrix` (`ListCollectionMatrixDto`, `reports.service.getCollectionMatrix`, controller).
- [ ] **P6.E** — Web: update wrapper return types in `src/lib/api/collection.ts` and `src/lib/api/reports.ts`.
- [ ] **P6.F** — Run API and web validation suites.
- [ ] **P6.G** — Close Phase 6 and recommend Phase 7.

### Files to review (Phase 6)

- `docs/api-review/implementation-roadmap.md` (Phase 6 scope, lines 144–158)
- `docs/api-review/performance-analysis.md` (P1.2, P1.5)
- `docs/api-review/web-impact-review.md` (Wave 3 lockstep rows)
- `docs/api-review/database-query-review.md` (Q1, Q2)
- `src/common/types/index.ts` (`PaginatedResult<T>` target shape)
- `src/modules/collection/collection.{service,controller}.ts`
- `src/modules/reports/reports.{service,controller}.ts`
- Phase 5 patterns: `src/modules/residents/dto/list-residents.dto.ts`, `src/modules/reports/dto/list-overdue.dto.ts`
- Web: `src/lib/api/collection.ts` (wrapper `fetchCollectionYear`)
- Web: `src/lib/api/reports.ts` (wrapper `fetchCollectionMatrix`)
- Web: `src/components/reports/CollectionControlReport/*` (audited — consumes mock data, not the API)

### Why not a separate progress file?

Same convention as Phases 0–5: a single source of truth in
`overall-progress.md` + the HTML companion. Per-phase files were
explicitly out of scope per the user instruction starting at Phase 0.

---

## Phase 6 — Architecture decision

Three pagination models were evaluated before any code change.

### Option A — Server-side pagination by resident range (chosen)

| Dimension | Detail |
|---|---|
| API impact | `/reports/collection-matrix` adds `page` + `limit`; `/collection` adds `page` + `limit`. Both wrap response in `{ data, meta }`. Tenant isolation unchanged. No new dependency. |
| Web impact | Wrapper return types update to envelope. Two unused wrappers, no live UI to refactor. |
| UX impact | None today (no live consumer). When the matrix UI is wired up later, scrolling pages residents server-side; month columns stay full at 12 (resident row already bounds the per-row data). |
| Payload impact | **Bounded** at `limit` residents × 12 months (matrix) or `limit` flat rows (collection). With default `limit=500`/`600` it covers every current tenant in one page. |
| Complexity | Low — direct reuse of Phases 4 & 5 patterns. |
| Risk | **Low** — type-only on web, mechanical on API, no new dep, no schema, no auth touch. |
| Compatibility | Preserves current behavior (single page covers full matrix for tenants < 500 residents). Aligns with the `{ data, meta }` standard set in Phase 4. |
| Validation | Snapshot test: capture `/collection-matrix?year=Y&limit=10000` before and after; equality on `data[]` (modulo envelope). Same for `/collection`. |

### Option B — Client-side virtualization, API keeps flat array

| Dimension | Detail |
|---|---|
| API impact | None. |
| Web impact | Install `@tanstack/react-virtual` (or `react-window`); refactor `CollectionMatrix` to render only visible rows. |
| UX impact | Smooth scrolling for large grids; sticky header preserved. |
| Payload impact | **Not bounded** — full matrix still on the wire. **Fails Phase 6's objective** of bounding the largest per-tenant response. |
| Complexity | Medium — new dep, refactor of matrix component, sticky-header tricks. |
| Risk | Medium — DOM rendering changes; payload concern unresolved. |
| Compatibility | UI-only; doesn't address API growth as tenants scale. |
| **Disqualified** | Phase 6 targets payload, not just rendering. Virtualization alone is insufficient and adds a dependency for no API benefit. |

### Option C — Hybrid: server pagination + web virtualization

| Dimension | Detail |
|---|---|
| API impact | Same as Option A. |
| Web impact | Option A + adding virtualization library. |
| UX impact | Optimal for very large tenants (> 500 residents) if/when the UI is wired up. |
| Payload impact | Bounded. |
| Complexity | High — combines both options. |
| Risk | Medium — extra dep for hypothetical scale. |
| **Out of scope today** | No live UI consumer exists, no tenant approaches 500 residents. Virtualization adds value when a real page is built and a real tenant exceeds the page size. Documented as a follow-up if measurement justifies it. |

### Decision: **Option A**

**Reasons**:
1. It bounds the payload (the explicit Phase 6 goal in
   `performance-analysis.md:78-87`).
2. It mirrors Phases 4 & 5 patterns exactly — same `{ data, meta }`
   envelope, same DTO style, same defaults strategy.
3. **No live UI consumer** today: the two web wrappers
   (`fetchCollectionYear`, `fetchCollectionMatrix`) have zero callers
   in the codebase, and the matrix UI in
   `src/components/reports/CollectionControlReport/*` consumes
   `MOCK_COLLECTION_RECORDS`, not the API. The lockstep cost is
   minimal: type-only on the web side, no UI refactor, no virtualization
   library install.
4. `limit=500` (matrix) and `limit=600` (flat collection) preserve
   today's behavior for every current tenant (largest seed < 300
   residents). If a real tenant ever exceeds 500 residents, the
   options are: raise the DTO default, layer Option C virtualization
   on top, or paginate client-side over the existing `meta`. None of
   these require schema work.
5. Matrix correctness is **trivially preserved** — see the
   "Matrix equivalence" section below.

### Matrix equivalence proof

Let `M(year)` be the full logical matrix for a tenant: rows are
residents ordered by `unitNumber asc`; columns are 12 months. Each
cell is a `CollectionRecord` (or absent when a record does not exist).

- **Single-page case** (`limit ≥ |R|`): the new response has
  `data.length === |R|`, in the same order, with identical per-row
  content. `JSON.stringify(oldResponse) === JSON.stringify(newResponse.data)`.
  Matrix equality is trivial.
- **Multi-page case**: `M = concat(page1.data, page2.data, …)` over
  pages ordered by `unitNumber asc`. Each `page.data` is a contiguous
  slice because `skip`/`take` preserves order. Concatenation reproduces
  `M` exactly.
- **Per-row month payload**: `months[]` is bounded at 12 entries per
  row by construction (`where: { year }, orderBy: { month: 'asc' }`).
  Unchanged from today.
- **Flat endpoint `/collection`**: same logic — `data` is a
  row-paginated slice of the same flat result, ordered by `month asc`.
  Concatenation reproduces the flat list.

**Manual validation steps** (deferred to post-deploy because the
working environment has no live API at planning time):

```bash
# Pre-deploy (current main)
curl "$BASE/condominiums/$SLUG/reports/collection-matrix?year=2026" \
  -H "Authorization: Bearer $TOKEN" > before.json

# Deploy Phase 6 → re-capture with a large limit
curl "$BASE/condominiums/$SLUG/reports/collection-matrix?year=2026&limit=10000" \
  -H "Authorization: Bearer $TOKEN" > after.json

# Compare data[] vs the pre-deploy flat array
jq '.data' after.json | diff - <(jq '.' before.json)

# Multi-page reconstruction
for p in 1 2 3 ...; do
  curl "...?year=2026&page=$p&limit=50" | jq '.data[]'
done | jq -s '.' > reconstructed.json
diff reconstructed.json <(jq '.' before.json)
```

---

## Phase 6 — API implementation (P6.C + P6.D)

- [x] **P6.C** — `/condominiums/:slug/collection` paginated.
  - **NEW** `src/modules/collection/dto/list-collection.dto.ts`:
    `ListCollectionDto` with `year?` (2000–2100, default current
    year), `page?` (≥1, default 1), `limit?` (1–1200, default
    **600**). All optional with Swagger annotations.
  - `src/modules/collection/collection.service.ts`:
    `findAll(condominiumId, dto: ListCollectionDto)` derives `year`,
    `page`, `limit`, `skip` from the DTO; builds
    `where = { condominiumId, year }`; runs
    `Promise.all([findMany({ where, include: { resident: { select } }, orderBy: [{ month: 'asc' }], skip, take }), count({ where })])`;
    returns `PaginatedResult<unknown>` (`{ data, meta: { total, page, limit, totalPages } }`).
    Imports `PaginatedResult` from `../../common/types` and
    `ListCollectionDto`.
  - `src/modules/collection/collection.controller.ts`: `@Get()` binds
    `@Query() dto: ListCollectionDto` and forwards. Removed the
    `parseInt(year)` step — DTO handles transform.
- [x] **P6.D** — `/condominiums/:slug/reports/collection-matrix` paginated.
  - **NEW** `src/modules/reports/dto/list-collection-matrix.dto.ts`:
    `ListCollectionMatrixDto` with `year?` (2000–2100, default
    current year), `page?` (≥1, default 1), `limit?` (1–1000,
    default **500**). Pagination unit is **residents** (one matrix
    row per resident).
  - `src/modules/reports/reports.service.ts`:
    `getCollectionMatrix(condominiumId, dto: ListCollectionMatrixDto)`
    derives `year`, `page`, `limit`, `skip`; builds
    `where = { condominiumId, deletedAt: null }`; runs
    `Promise.all([resident.findMany({ where, include: { collectionRecords: { where: { year }, orderBy: { month: 'asc' } } }, orderBy: { unitNumber: 'asc' }, skip, take }), resident.count({ where })])`;
    `.map(...)` reshape runs on the current page only; returns
    `PaginatedResult<unknown>`. Added import of
    `ListCollectionMatrixDto`.
  - `src/modules/reports/reports.controller.ts`: `@Get('collection-matrix')`
    binds `@Query() dto: ListCollectionMatrixDto`. Removed
    `parseInt(year)`.

### Wire shape change (per endpoint)

| Endpoint | Old shape | New shape |
|---|---|---|
| `GET /condominiums/:slug/collection?year=Y` | `CollectionRecord[]` (flat, with nested `resident.select`) | `{ data: CollectionRecord[], meta: { total, page, limit, totalPages } }` |
| `GET /condominiums/:slug/reports/collection-matrix?year=Y` | `CollectionMatrixRow[]` (per-resident, with 12-month embedded `months[]`) | `{ data: CollectionMatrixRow[], meta: { total, page, limit, totalPages } }` |

Both responses are still wrapped by the global `{ data: ... }`
envelope from `ResponseInterceptor`. Per-row `months[]` payload is
unchanged. Order preserved: `month asc` for `/collection`,
`unitNumber asc` for `/reports/collection-matrix`.

### Files modified (Phase 6 — API side)

| File | Change |
|---|---|
| **NEW** `src/modules/collection/dto/list-collection.dto.ts` | `ListCollectionDto` — `year?` (2000–2100), `page?` (≥1, default 1), `limit?` (1–1200, default 600). |
| `src/modules/collection/collection.service.ts` | `findAll` accepts `ListCollectionDto`; `Promise.all([findMany, count])`; returns `PaginatedResult`. Imports `PaginatedResult` + `ListCollectionDto`. |
| `src/modules/collection/collection.controller.ts` | `@Get()` binds `@Query() dto: ListCollectionDto`; `parseInt` removed. Imports `ListCollectionDto`. |
| **NEW** `src/modules/reports/dto/list-collection-matrix.dto.ts` | `ListCollectionMatrixDto` — same shape as `ListCollectionDto` but `limit?` 1–1000 default 500 (pagination unit is residents). |
| `src/modules/reports/reports.service.ts` | `getCollectionMatrix` accepts `ListCollectionMatrixDto`; `Promise.all([resident.findMany, resident.count])`; `.map(...)` runs on page only; returns `PaginatedResult`. Imports `ListCollectionMatrixDto`. |
| `src/modules/reports/reports.controller.ts` | `@Get('collection-matrix')` binds `@Query() dto: ListCollectionMatrixDto`; `parseInt` removed. Imports `ListCollectionMatrixDto`. |

### Validation performed (Phase 6 — API side)

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` clean. New DTOs + decorators compile; service signatures and `PaginatedResult` return types resolve. |
| `npm test` | **PASS** | 2 suites, 65 unit tests — same baseline as Phases 0–5. No suite asserts pagination/filter shape. |
| `grep "findMany\\|Promise.all\\|count" src/modules/collection/collection.service.ts src/modules/reports/reports.service.ts` | **PASS** | `collection.findAll` and `getCollectionMatrix` both wrap their `findMany` calls in `Promise.all([findMany({ skip, take, where, … }), count({ where })])`. |
| `grep -rn "ListCollectionDto\\|ListCollectionMatrixDto" src/modules/collection/ src/modules/reports/` | **PASS** | Each DTO imported in both controller and service. |
| `npm run lint` | **FAIL (pre-existing)** | Same ESLint v9 vs legacy `.eslintrc` mismatch carried over from Phase 0; not introduced here. |
| `npm run test:e2e` | **SKIPPED** | `test/` folder still absent; e2e harness not configured. |

### Risks introduced or surfaced — Phase 6 (API side)

- **Default `limit` ceiling**: tenants with > 600 collection records
  (i.e., > 50 residents × 12 months) on `/collection`, or > 500
  residents on `/reports/collection-matrix`, will see paginated data
  on first call. Raise the DTO default if the matrix UI is wired up
  before a tenant of that size appears. **Do not** expose `Infinity`
  (DoS surface).
- **Year transform via DTO**: `year` is now parsed via
  `@Type(() => Number) @IsInt() @Min(2000) @Max(2100)`. This is a
  stricter accept-set than the old `parseInt(year, 10)` (which would
  silently coerce "2.5" → 2 or "abc" → NaN). The new behavior rejects
  invalid years with a 400. Documented as intentional tightening.
- **No live UI consumer** (carried from the architecture decision
  section): the matrix UI today consumes `MOCK_COLLECTION_RECORDS`.
  Wiring the live API is a separate follow-up task, not Phase 6 work.

---

## Phase 6 — Web implementation (P6.E)

- [x] **P6.E** — Wrapper return types updated.
  - `src/lib/api/collection.ts`: imports
    `PaginationMeta` (`type`-only) from `./reports`. Adds
    `CollectionYearResponse = { data: CollectionRecord[], meta: PaginationMeta }`
    and `CollectionYearParams = { year?, page?, limit? }`.
    `fetchCollectionYear(slug, token, params?)` now builds a
    `URLSearchParams` (`year` always set; `page`/`limit` only when
    provided) and returns the envelope. Default `year` is
    `new Date().getFullYear()` — same as before.
  - `src/lib/api/reports.ts`: adds
    `CollectionMatrixResponse = { data: CollectionMatrixRow[], meta: PaginationMeta }`
    and `CollectionMatrixParams = { year?, page?, limit? }`.
    `fetchCollectionMatrix(slug, token, params?)` builds the same
    query-string shape and returns the envelope. `PaginationMeta`
    interface is now re-exported via the same module that defined it
    in Phase 5.

### Files modified (Phase 6 — web side)

| File | Change |
|---|---|
| `src/lib/api/collection.ts` | New types `CollectionYearResponse`, `CollectionYearParams`. `fetchCollectionYear(slug, token, params?)` returns the envelope; URL built with `URLSearchParams`. `PaginationMeta` imported `type`-only from `./reports`. |
| `src/lib/api/reports.ts` | New types `CollectionMatrixResponse`, `CollectionMatrixParams`. `fetchCollectionMatrix(slug, token, params?)` returns the envelope; URL built with `URLSearchParams`. |
| `tsconfig.tsbuildinfo` | Regenerated by `pnpm typecheck` / `pnpm build`. |

**No changes to**: any component file (no live consumer), proxy
routes (none exist for these endpoints today), mock data, the
`CollectionControlReport` tree, i18n, the `/api/residents` proxy
route, the upload UI. No new dependency installed.

### Validation performed (Phase 6 — web side)

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | **PASS** | `tsc --noEmit` clean. New wrapper return shapes resolve. |
| `pnpm test` | **PASS** | 6 vitest suites, 125 tests — same baseline as Phase 5. |
| `pnpm build` | **PASS** | `next build` clean. All routes + API proxies compile. |
| `grep "fetchCollectionYear\\|fetchCollectionMatrix" src/` | **PASS** | Only the two declarations remain; no live caller is broken. |

### Cross-repo lockstep checklist

- API now returns `{ data, meta }` on both endpoints. ✅
- Web wrappers consume `{ data, meta }`. ✅
- No live UI consumer needs migration (matrix UI reads mock data; the
  two wrappers had zero callers in the codebase). ✅
- Defaults preserve current behavior (`limit=500` matrix /
  `limit=600` flat) for every current tenant. ✅
- Tenant isolation, auth/role guards, response/error envelope,
  Prisma schema, migrations, indexes — **all unchanged**. ✅

---

## Impact status (cumulative through Phase 6)

| Dimension | Status | Detail |
|---|---|---|
| Web app changes | **Required and completed** (type-only this phase) | Phase 6 updated 2 wrapper files only. No component refactor, no proxy-route addition, no new dependency. Earlier-phase web changes (Phase 5 wrappers + proxy + components, Phase 4 wrappers) remain in place. |
| API contract | **Changed — `/collection` and `/reports/collection-matrix`** | Both endpoints now return `{ data, meta: { total, page, limit, totalPages } }` wrapped by the global `{ data: ... }` envelope. Optional `page` / `limit` query params accepted. `year` is now DTO-validated (2000–2100) instead of `parseInt`-coerced. Earlier-phase deltas (residents/overdue/account-statement pagination, imports/upload warnings, /docs 404 in prod, petty-cash 409, calendar `from`/`to` required + 365-day cap, `findReconciled` no longer ships `matchedCalendarEvent`, `classifyBatch` chunk-uniform `matchedAt`, transactions/imports nested `meta`) still apply. |
| Database / Prisma | **Unchanged** | No schema edits, no migrations, no new indexes. New `where` clauses scan within `condominiumId`-indexed subsets. |
| Tenant isolation | **Unchanged** | `condominiumId` (from `CondominiumAccessGuard`) flows into every `where`. No tenant data accepted from query params. |
| AuthN / AuthZ | **Unchanged** | No identity-layer code touched. |
| Audit behavior | **Unchanged** | Matrix endpoints write no audit logs. |
| Matrix correctness | **Preserved** | Single-page case is structurally identical to today's response. Multi-page case is order-stable and reconstructs the full matrix on concatenation. Proof + manual snapshot commands documented above. |

---

## Risks / blockers detected — Phase 6

- **Default `limit` ceilings** (`limit=500` matrix, `limit=600` flat):
  not equivalent to `Infinity`. A future tenant with > 500 residents
  will see paginated data on first call to `/reports/collection-matrix`.
  When this surfaces, the options are: raise the DTO default (file
  edit, no migration), pass a higher `limit` from the caller, layer
  Option C (client-side virtualization) on top, or paginate
  client-side over the existing `meta`. Do **not** expose `Infinity`
  (DoS surface).
- **No live UI consumer for the matrix wrappers** (deliberate, see
  architecture decision section): the matrix UI in
  `CollectionControlReport` still consumes
  `MOCK_COLLECTION_RECORDS`. Wiring the live API is a separate
  follow-up task — out of Phase 6 scope. When that work is done, the
  consumer should: (a) call `fetchCollectionMatrix(slug, token, {
  year, page, limit })`, (b) read `.data` / `.meta`, (c) optionally
  add filter params (`q`, `paymentStatus`, …) that Phase 6 did not
  introduce.
- **Year DTO tightening**: `year` is now strictly an integer between
  2000 and 2100. The old `parseInt(year, 10)` would silently coerce
  invalid strings to `NaN` and produce a runtime error or unintended
  default; the new validator returns HTTP 400 with a clear message
  for any out-of-range or non-numeric value. Documented as
  intentional tightening; no known caller passes invalid years today.
- **Carryovers from earlier phases** remain open: ESLint v9 config
  gap, missing e2e harness, dashboard snake_case fallback bug at
  `dashboard.service.ts:136-146`, R4.2 `runningBalance` race,
  petty-cash parallel reads opportunity, deferred `id` trims on inner
  selects, deferred calendar enum tightening, generic `findAll`
  defensive include, P3.B queue-based classification stretch,
  live-seed equivalence test for `classifyBatch`,
  `reconciliation-rules` flat shape, external API consumer
  assumption, `ResidentsTable` rolling server-side pagination,
  Phase 5 overdue + statement pages still placeholder.

---

## Remaining work in Phase 6

**None.** P6.A through P6.G are complete. Out-of-scope items
(wiring `CollectionControlReport` to live API, client-side
virtualization, additional filter params, `findByResident`
pagination, `reconciliation-rules` flat-shape standardization) are
documented as follow-ups, not Phase 6 work.

---

## Recommended next step (historical — superseded by Phase 7 close)

*This section reflected the state at Phase 6 close. Phase 7 has now
been implemented; see the "Phase 7 — Closed" section below and the
final "Recommended next step" at the end of this document.*

---

## Phase 7 — Closed

**Roadmap line**: `implementation-roadmap.md:162-176` — *Phase 7 —
Paginate calendar / inventory / common-areas / petty-cash (API+web,
rolling). Objective: close out the remaining unbounded lists.*

**Status**: ✅ Complete · **% complete**: **100%** ·
**Overall implementation**: **87.5%** (7 of 8 roadmap phases closed;
Phase 8 deferred per user instruction).

### Per-endpoint contract delta

| Endpoint | Old behavior | New behavior | New query params | Defaults | Max | Rolling vs lockstep | Web wrapper / page affected | Validation |
|---|---|---|---|---|---|---|---|---|
| `GET /condominiums/:slug/calendar/events` | Flat `CalendarEvent[]`; `from`/`to` required (Phase 2 ✅); `type?`, `status?` filters | `{ data: CalendarEvent[], meta: { total, page, limit, totalPages } }` | `page?: int ≥ 1`; `limit?: int 1–2000` | `page=1`, `limit=500` | 2000 | **Lockstep micro-coordination** within the overall rolling phase — single wrapper + single component update | `src/lib/api/calendar.ts:getCalendarEvents` + `src/components/calendar/CalendarEventList/index.tsx` (1 `.then` destructuring) | API build PASS · 65 unit tests PASS · web typecheck/build/tests PASS (125/125) |
| `GET /condominiums/:slug/common-areas` | Flat `CommonArea[]` (with `inventoryItems` nested); no query params | `{ data: CommonArea[], meta }` | `page?: int ≥ 1`; `limit?: int 1–500` | `page=1`, `limit=200` | 500 | **Rolling** (no live web consumer; `CommonAreasTable` reads mock data) | None today — wiring deferred | API build PASS · 65 unit tests PASS |
| `GET /condominiums/:slug/inventory` | Flat `InventoryItem[]` (with `commonArea` projection); no query params | `{ data: InventoryItem[], meta }` | `page?: int ≥ 1`; `limit?: int 1–1000` | `page=1`, `limit=200` | 1000 | **Rolling** (no live web consumer; `InventoryItemsTable` reads mock data) | None today — wiring deferred | API build PASS · 65 unit tests PASS |
| `GET /condominiums/:slug/petty-cash` | Flat `PettyCashMovement[]` (with `registeredBy` projection); no query params | `{ data: PettyCashMovement[], meta }` | `page?: int ≥ 1`; `limit?: int 1–1000` | `page=1`, `limit=200` | 1000 | **Rolling** (no live web consumer; `PettyCashMovementsTable` reads mock data) | None today — wiring deferred | API build PASS · 65 unit tests PASS |

All four endpoints preserve their existing `where` clauses (tenant
isolation via `CondominiumAccessGuard`), existing `include`/`select`
projections, and existing `orderBy` clauses. No new filters or sort
options were added (out of roadmap scope).

### Architecture decision — rolling vs lockstep per endpoint

The roadmap labels Phase 7 as **rolling**. The decision applies
unchanged to three of the four endpoints (no live web consumer
exists — API can ship without web coordination). For the calendar
endpoint, the existing `getCalendarEvents()` wrapper returned a bare
array and `CalendarEventList` iterated it directly, so a pure shape
change required updating the wrapper + the single consumer in the
same release window — effectively **lockstep micro-coordination**
inside the overall rolling phase. This was chosen over inventing a
transitional shape (e.g. a `?paginated=1` flag or a parallel
endpoint) because the web surface area is one wrapper file plus one
`.then` destructuring — the smallest possible coordinated change.
Documented explicitly so future audits don't read the rolling label
as a contradiction with the calendar update.

### Task tracking

- [x] **P7.A** — Calendar list pagination (DTO + service)
- [x] **P7.B** — Common-areas list pagination (DTO + service + controller)
- [x] **P7.C** — Inventory items list pagination (DTO + service + controller)
- [x] **P7.D** — Petty-cash list pagination (DTO + service + controller)
- [x] **P7.E** — Web calendar wrapper + `CalendarEventList` envelope migration
- [x] **P7.F** — Close progress files at 100%

---

## Files reviewed (Phase 7)

- `docs/api-review/implementation-roadmap.md` (Phase 7 scope, lines 162–176)
- `docs/api-review/performance-analysis.md`, `database-query-review.md` (Q1)
- `docs/api-review/web-impact-review.md` (Wave 4 — rolling)
- `docs/api-review/risk-analysis.md` (no new risks introduced)
- `docs/api-review/progress/overall-progress.md` (Phase 6 close confirmation)
- `src/common/types/index.ts` (`PaginatedResult<T>` template)
- `src/modules/residents/dto/list-residents.dto.ts`, `src/modules/collection/dto/list-collection.dto.ts` (DTO templates)
- `src/modules/calendar/calendar.service.ts`, `calendar.controller.ts`, `dto/list-calendar-events.dto.ts`
- `src/modules/inventory/inventory.service.ts`, `inventory.controller.ts`, existing `dto/`
- `src/modules/petty-cash/petty-cash.service.ts`, `petty-cash.controller.ts`, existing `dto/`
- Web: `src/lib/api/calendar.ts`, `src/lib/api/reports.ts` (`PaginationMeta` reuse), `src/components/calendar/CalendarEventList/index.tsx`

## Files modified (Phase 7)

### API repo

| File | Change |
|---|---|
| `src/modules/calendar/dto/list-calendar-events.dto.ts` | Added `page?` (`@IsOptional @Type(() => Number) @IsInt @Min(1)`) and `limit?` (`@Min(1) @Max(2000)`, default 500). Existing `from`/`to`/`type`/`status` validators preserved. |
| `src/modules/calendar/calendar.service.ts` | `findAll` now returns `PaginatedResult<unknown>`. Derives `page`/`limit`/`skip` from DTO; wraps `findMany` + `count` in `Promise.all`; preserves overlap range filter, `orderBy: { startDate: 'asc' }`, and the existing `resident`/`createdBy` projections. Added `PaginatedResult` import from `../../common/types`. |
| **NEW** `src/modules/inventory/dto/list-common-areas.dto.ts` | `ListCommonAreasDto` with `page?` (default 1) and `limit?` (`@Max(500)`, default 200). |
| **NEW** `src/modules/inventory/dto/list-inventory-items.dto.ts` | `ListInventoryItemsDto` with `page?` (default 1) and `limit?` (`@Max(1000)`, default 200). |
| `src/modules/inventory/inventory.service.ts` | `findAllAreas` and `findAllItems` accept the new DTOs (`= {}` default for back-compat), compute skip/take, run `Promise.all([findMany, count])`, return `PaginatedResult`. Existing `include` (`inventoryItems: true` / `commonArea: { select: { id, name } }`) and `orderBy` (`name asc` / `createdAt desc`) preserved. Added `PaginatedResult` + DTO imports. |
| `src/modules/inventory/inventory.controller.ts` | Both list `@Get()` methods now bind `@Query() query: ListCommonAreasDto` / `@Query() query: ListInventoryItemsDto`. Swagger summaries updated to mention pagination. Added `Query` to `@nestjs/common` import + DTO imports. |
| **NEW** `src/modules/petty-cash/dto/list-petty-cash.dto.ts` | `ListPettyCashDto` with `page?` (default 1) and `limit?` (`@Max(1000)`, default 200). |
| `src/modules/petty-cash/petty-cash.service.ts` | `findAll` accepts the DTO, computes skip/take, runs `Promise.all([findMany, count])`, returns `PaginatedResult`. Existing `include` (`registeredBy: { select: ... }`) and `orderBy: { date: 'desc' }` preserved. Added `PaginatedResult` + DTO imports. |
| `src/modules/petty-cash/petty-cash.controller.ts` | List `@Get()` binds `@Query() query: ListPettyCashDto`. Added `Query` to `@nestjs/common` import + DTO import. |
| `docs/api-review/progress/overall-progress.md` | Phase 7 status updates (kickoff + close). |
| `docs/api-review/progress/overall-progress.html` | Phase 7 status updates (kickoff + close). |

### Web repo

| File | Change |
|---|---|
| `src/lib/api/calendar.ts` | Added `import type { PaginationMeta } from "./reports"`. Extended `CalendarEventQuery` with optional `page?`, `limit?`. Added `CalendarEventListResponse = { data: CalendarEvent[]; meta: PaginationMeta }`. Updated `getCalendarEvents` return type to `Promise<CalendarEventListResponse>`; `URLSearchParams` now also forwards `page`/`limit` when provided. |
| `src/components/calendar/CalendarEventList/index.tsx` | Single `.then((data) => setEvents(Array.isArray(data) ? data : []))` updated to `.then((response) => { const data = response?.data; setEvents(Array.isArray(data) ? data : []); })`. Defensive `Array.isArray(...) ? : []` fallback preserved. No other changes; filters, sort, loading/error states untouched. |

**Not modified** (out of scope; documented as deferred follow-ups):

- `src/components/inventory/CommonAreasTable/*`, `src/components/inventory/InventoryItemsTable/*`, `src/components/petty-cash/PettyCashMovementsTable/*` — still consume mock data; wiring to live API is a separate UI-modernization workstream.
- `src/app/api/calendar/events/route.ts` — proxy passes through raw JSON; the envelope flows through unchanged.
- `TablePagination` UI component — no signature change required.
- `src/modules/reconciliation-rules/reconciliation-rules.service.ts` — flat shape `{ data, total, page, limit, totalPages }`. Not on the Phase 7 roadmap line; per user instruction "do not implement unrelated performance findings", explicitly deferred.

---

## Validation performed — Phase 7

### API repo

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` clean after each module (calendar, inventory, petty-cash). New DTOs + decorators compile; `PaginatedResult<unknown>` return types resolve. |
| `npm test` | **PASS** | 2 suites, 65 unit tests pass (`terrace-booking-matcher` + `terrace-metadata.validator`). No new tests; baseline preserved. |
| `grep -n "findMany\b"` on the three services | **PASS** | Four `findMany` call sites — calendar (line 73), inventory areas (25), inventory items (86), petty-cash (29) — each sits inside `Promise.all([findMany, count])`. |
| DTO usage grep across all three modules | **PASS** | Every DTO imported in both controller and service; bound via `@Query()` on each list method. |
| `npm run lint` | **FAIL (pre-existing)** | ESLint 9 vs legacy `.eslintrc`; same Phase-0 carryover. **Not introduced by Phase 7.** |
| `npm run test:e2e` | **SKIPPED** | `test/` folder absent (Phase-0 carryover). |

### Web repo

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | **PASS** | `tsc --noEmit` clean. New `CalendarEventListResponse` and the destructured `response.data` resolve. |
| `pnpm build` | **PASS** | `next build` succeeds. |
| `pnpm test` | **PASS** | 6 vitest suites, 125 tests pass. |
| `grep -rn "getCalendarEvents\b" src/` | **PASS** | One live consumer (`CalendarEventList`), now destructuring `data` from the envelope; wrapper definition + call site only. |

**Manual smoke checks** — defer to deploy; environment not exercised
in this session. To validate live:

- Visit `/[locale]/(app)/[condominiumSlug]/calendar`; events render
  for the current month, week, day, year views.
- Calendar `type`/`status` filters continue to apply.
- Mock-data tables (common-areas, inventory items, petty-cash)
  render unchanged client-side filtering/sort/pagination.

---

## Risks / blockers detected — Phase 7

- **Calendar lockstep micro-coordination** — flagged in the
  architecture decision above. The smallest possible web surface
  area (one wrapper + one `.then` destructuring) ships together with
  the API change. Web rollback is a single `git checkout` if needed.
- **Mock-data tables remain on mock data** — explicitly out of
  scope. The three inventory/petty-cash tables continue to render
  mock data after Phase 7. The API-side endpoints are now paginated
  and ready to be consumed when those tables are wired up in a
  future UI-modernization task.
- **Carryovers from earlier phases** — ESLint v9 config gap, missing
  e2e harness, dashboard snake_case fallback bug, R4.2
  `runningBalance` race, `classifyBatch` snapshot equivalence test,
  `ResidentsTable` server-side pagination, overdue + statement page
  builds, `reconciliation-rules` flat shape. All remain open and can
  be picked up alongside Phase 8 evaluation or scheduled
  independently.

---

## Impact status (cumulative through Phase 7)

| Dimension          | Status | Detail |
|--------------------|--------|--------|
| Web app changes    | **Calendar wrapper + consumer migrated** (one wrapper + one `.then`). Mock-data tables unchanged. | Lockstep micro-coordination on calendar only; no other live consumer of the four Phase 7 endpoints exists. |
| API contract       | **Shape change on four list endpoints** — flat array → `{ data, meta }` envelope. Defaults preserve content for every current tenant in a single page. All other contracts preserved (paths, error envelope, success interceptor, non-list methods). | Same envelope pattern as Phases 4–6; no new dependencies; no new endpoints. |
| Database / Prisma  | **Unchanged** | No schema edits, no migrations, no new indexes. Each `where` is covered by existing indexes on `condominiumId`. |
| Tenant isolation   | **Unchanged** | All four `where` clauses still derive `condominiumId` from `CondominiumAccessGuard`. |
| AuthN / AuthZ      | **Unchanged** | No identity-layer code touched; existing `RolesGuard` decorators preserved on non-list methods. |

---

## Remaining work in Phase 7

**None.** Phase 7 is complete.

---

## Phase 8 — Evaluation (2026-05-13)

**Roadmap line**: `implementation-roadmap.md:179-194` —
*Phase 8 — Index hardening (DB migration, deferred). Objective: add
composite indexes only when measured pressure warrants. Do not
pre-emptively migrate.*

**Status**: ✅ Evaluated · ❄️ Implementation deferred · 0% migration
work performed; 100% of the three candidate items have a recorded
decision with future trigger conditions.

### Phase 8 scope (verbatim from roadmap)

| # | Item | Roadmap trigger | Risk |
|---|------|------------------|------|
| 1 | `@@index([condominiumId, createdAt])` on `AuditLog` (`prisma/schema.prisma:647`) | **when log table > 1M rows** | low |
| 2 | `@@index([condominiumId, fileHash])` on `ImportBatch` (`prisma/schema.prisma:534`) | **only if dedup query shows up in slow log** | low |
| 3 | Replace petty-cash folio `count + 1` with per-condominium sequence (R4.1) | **when concurrent creates become real** | low |

Roadmap framing (`implementation-roadmap.md:208`): *"Phase 8 is
opportunistic — only when telemetry demands it."*

### Current schema state (verified against `prisma/schema.prisma`)

- **AuditLog** (`prisma/schema.prisma:626-654`) — `@@index([condominiumId])`,
  `@@index([userId])`, `@@index([module])`, `@@index([action])`,
  `@@index([result])`, `@@index([createdAt])`. `condominiumId` and
  `createdAt` are indexed **separately**; no composite. Matches the
  review's prediction.
- **ImportBatch** (`prisma/schema.prisma:507-539`) — `@@index([condominiumId])`,
  `@@index([fileHash])`, `@@index([status])`, `@@index([createdAt])`.
  `condominiumId` and `fileHash` indexed **separately**; no composite,
  no unique constraint. Matches review.
- **PettyCashMovement** (`prisma/schema.prisma:424-456`) —
  `@@unique([condominiumId, folio])`, `@@index([condominiumId])`,
  `@@index([status])`, `@@index([date])`. The composite unique
  constraint already prevents data corruption; a race only produces a
  P2002 that the existing service code retries.

### Current folio code (`src/modules/petty-cash/petty-cash.service.ts:82-117`)

A defensive 5-retry loop **already exists** today:

```ts
for (let attempt = 0; attempt < MAX_FOLIO_RETRIES; attempt++) {
  const count = await this.prisma.pettyCashMovement.count({ where: { condominiumId } });
  const folio = `PC-${String(count + 1 + attempt).padStart(4, '0')}`;
  try {
    return await this.prisma.pettyCashMovement.create({ data: { ..., folio, ... } });
  } catch (err) {
    if (isUniqueFolioViolation) continue;
    throw err;
  }
}
throw new ConflictException('Could not generate unique folio after retries');
```

`MAX_FOLIO_RETRIES = 5`. No `$transaction` wrapper, no advisory lock,
no sequence table. Combined with the `@@unique([condominiumId, folio])`
constraint, this yields: *successful folio after up to 5 simultaneous
collisions; only sustained simultaneous creates by 6+ admins on the
same tenant within the same instant produce a bubble-up
`ConflictException` → HTTP 409*. `risk-analysis.md` R4.1 classifies
severity as **low (UX, no data corruption)**.

### Per-item decision matrix

| Item | Current state | Proposed future state | Evidence found | Decision | Reasoning | Risk level | Implementation status | Future trigger condition | Validation performed |
|------|---------------|------------------------|----------------|----------|-----------|------------|------------------------|---------------------------|----------------------|
| **AuditLog composite `[condominiumId, createdAt]`** | Per-column indexes on `condominiumId` and `createdAt` (separate). | Composite `@@index([condominiumId, createdAt])` for tenant-scoped paginated reads ordered by recency. | Analytical only — `performance-analysis.md` P2.3 ("low (currently)"), `database-query-review.md` line 117-132 ("adequate per-column, missing composite"), migration-recommendations line 294 ("When tenant audit log exceeds ~1M rows"). **No row-count telemetry, no EXPLAIN ANALYZE, no slow-query log.** | **Defer (Monitor)** | Trigger threshold (>1M rows per tenant) is well above current scale; per-column indexes cover today's filters; Postgres index merge is acceptable. Adding the composite now would pollute migration history without measurable benefit. | low | **Not implemented** — no schema change, no migration. | First production telemetry showing AuditLog `findMany` with `WHERE condominiumId = $1 ORDER BY createdAt DESC` p95 > 100 ms, **OR** any single tenant `audit_logs` row count > 500 k (early-warning threshold below the 1 M trigger). | Code/schema read of `prisma/schema.prisma:626-654` to confirm current index layout. No DB measurements (no live runtime DB available in this session). |
| **ImportBatch composite `[condominiumId, fileHash]`** | Per-column indexes on `condominiumId` and `fileHash` (separate). | Composite `@@index([condominiumId, fileHash])` for SHA-256 dedup `findFirst` queries. | Analytical only — `database-query-review.md` line 102-115 explicitly notes *"Postgres can index-merge but a composite would be slightly faster"* and classifies the change as *"Optional optimization for very high write volume."* Phase 8 task line `implementation-roadmap.md:187` makes implementation conditional on *"dedup query shows up in slow log."* `performance-analysis.md` P3.1 is about request latency (already addressed by Phase 1 P1.B batched dedup), not index speed. **No slow-log evidence.** | **Defer (Monitor)** | Phase 1 P1.B already converted per-file lookups into a single batched `findMany`. Index merge is adequate for current volumes. No slow-log signal exists. Adding the composite is a pure micro-optimization with no observed need. | low | **Not implemented** — no schema change, no migration. | First slow-query observation of the dedup `findFirst({ where: { condominiumId, fileHash } })` call (`imports.service.ts:119, 235`), **OR** import volume exceeding ~100 batches/day on any single tenant, **OR** any tenant's `import_batches` table exceeding ~250 k rows. | Code/schema read of `prisma/schema.prisma:507-539`; cross-reference to `imports.service.ts` dedup call sites. No DB measurements available in this session. |
| **Petty-cash folio sequence** | `count + 1` inside a 5-retry P2002 catch loop (`petty-cash.service.ts:82-117`), guarded by `@@unique([condominiumId, folio])`. Not in a `$transaction`, no advisory lock. | Per-condominium sequence table or `SELECT … FOR UPDATE` against a counter row inside a `$transaction`, eliminating the race at write time. | Code review only — `risk-analysis.md` R4.1 (severity **low — UX only, no data corruption**), `performance-analysis.md` P3.2 ("3 sequential queries… not race-safe under concurrent writes"), `risk-analysis.md` R4.2 (separate `runningBalance` race, **medium severity**, but explicitly out of Phase 8 scope and requiring a different fix — `SELECT … FOR UPDATE` on the previous movement). **No measurement of concurrent admin-create rate.** | **Defer (Monitor)** | Defensive retry loop already converts the race into an at-most-rare 409. R4.1 severity is *low*; introducing a sequence is a one-way migration that should be load-justified. R4.2 (`runningBalance` race, medium-severity correctness risk) is a separate workstream — not in Phase 8 scope — and would need its own dedicated treatment regardless of folio strategy. | low | **Not implemented** — no schema change, no migration, no service rewrite. The existing 5-retry P2002 loop is the cheap reversible mitigation. | First production occurrence of `ConflictException('Could not generate unique folio after retries')` in the petty-cash service logs, **OR** measured concurrent admin-create rate on the same tenant > 1/sec, **OR** any user-reported folio collision. R4.2 (`runningBalance` race) should be treated as an independent fix when concurrent writes become a real concern. | Code read of `petty-cash.service.ts:82-117` and schema check of `PettyCashMovement` to confirm the unique constraint protects data integrity today. No DB measurements available in this session. |

**Net Phase 8 outcome**: **Deferred (3/3).** No schema change, no
migration, no code change, no web change. Each item carries a recorded
decision and a measurable future trigger condition.

### Evidence inventory (measurement infrastructure available to this session)

The decision is evidence-driven by *absence* — none of the three
roadmap-defined triggers can be tested against real data in this
environment because the prerequisite observability infrastructure is
not installed. Verified inventory of what *is* available:

| Signal source | Available? | Notes |
|---------------|------------|-------|
| Slow-query log (Postgres `log_min_duration_statement` or Neon equivalent) | **No** | No committed export under `docs/`; production access not in this session. |
| `pg_stat_statements` snapshot | **No** | No committed artifact; not exposed via the application. |
| Per-tenant `audit_logs` row count | **No** | No telemetry; would require live DB access. |
| Per-tenant `import_batches` row count | **No** | No telemetry; same constraint. |
| Petty-cash folio-collision occurrences | **No** | No structured log committed; no APM. |
| APM / tracing (Sentry · Datadog · OpenTelemetry · Prisma `$on("query")`) | **No** | `grep -rni "Sentry|OpenTelemetry|Datadog|prisma.\$on" src/` empty. `package.json` contains no `prisma:explain`, `db:analyze`, or `slow-query` scripts. |
| Inline TODO / FIXME flags in `audit.service.ts`, `imports.service.ts`, `petty-cash.service.ts` | **No** | None found. |
| Live DB access in this evaluation session | **No** | `.env.example` exposes Neon placeholders only; this session does not hold production credentials and cannot run `EXPLAIN ANALYZE`. |
| Migration velocity context | **Yes** | 8 migrations in 4 days (2026-05-09 → 2026-05-13). Schema evolution is active — adding an unjustified composite index would pollute migration history. |

**Limitation note (per user instruction)**: *No runtime DB access was
available during the Phase 8 evaluation. No representative
`EXPLAIN ANALYZE` was run. This is documented rather than worked
around — guessing would violate the "evidence-driven" rule the user
explicitly set.*

### Evaluation work performed

- Read `docs/api-review/implementation-roadmap.md` Phase 8 section
  (verbatim Phase 8 scope; the roadmap's "opportunistic" framing on
  line 208).
- Read `docs/api-review/performance-analysis.md` P2.3, P3.1, P3.2 to
  re-confirm each candidate finding's severity remains low and that
  no new measurement has been added since prior phases closed.
- Read `docs/api-review/risk-analysis.md` R4.1 (folio race — low) and
  R4.2 (`runningBalance` race — medium, separate workstream).
- Read `docs/api-review/database-query-review.md` lines 102-132 +
  migration-recommendations (lines 294-295) to confirm the trigger
  thresholds are documented but not met.
- Re-read `prisma/schema.prisma` for the three target models to
  verify current index layout matches what the review documents
  asserted.
- Re-read `src/modules/petty-cash/petty-cash.service.ts:82-117` to
  confirm the defensive 5-retry loop is in place (P1.C from Phase 1).
- Inventoried measurement infrastructure across the API repo (APM
  packages, `package.json` scripts, committed slow-query artifacts,
  inline TODO/FIXME flags).
- Confirmed prerequisite: Phases 0–7 are all at 100% in this
  document, last updated 2026-05-13.

### Impact status (Phase 8)

| Surface | Status | Notes |
|---------|--------|-------|
| Prisma schema | **Unchanged** | No new `@@index`, no new model, no new field. |
| Prisma migrations | **Unchanged** | No new migration file created. `ls prisma/migrations` unchanged. |
| API endpoint contracts | **Unchanged** | No controller, service, or DTO edited. |
| Success / error response envelopes | **Unchanged** | No interceptor or filter touched. |
| Tenant isolation | **Unchanged** | No guard, no `where`-clause sourcing modification. |
| AuthN / AuthZ | **Unchanged** | No identity-layer file touched. |
| Web app | **Unchanged** | No file in the web repo touched. |
| Documentation | **Updated** | Only `docs/api-review/progress/overall-progress.md` and `overall-progress.html` modified to record the evaluation. |

### Validation performed (Phase 8)

Because no code or schema changes were authored, validation was
intentionally scoped to *review verification* rather than test
execution:

| # | Check | Result |
|---|-------|--------|
| 1 | Markdown structure intact (table syntax, headings, link anchors) | ✅ Pass — visual review. |
| 2 | HTML structure intact (tags closed, class names match existing tokens) | ✅ Pass — visual review. |
| 3 | `git status` in the API repo shows only the two progress files modified | ✅ Pass — verified after edits. |
| 4 | `git diff prisma/` empty | ✅ Pass — nothing under `prisma/` touched. |
| 5 | `git diff src/` empty | ✅ Pass — nothing under `src/` touched. |
| 6 | Web repo working tree untouched | ✅ Pass — no edits dispatched to the web repo. |

Skipped (explicitly justified — docs-only diff): `pnpm lint`,
`pnpm test`, `pnpm test:e2e`, `pnpm build`, `prisma validate`. No
code or schema delta to validate.

### Risks / blockers detected (Phase 8)

- **Observability bootstrap is the real blocker for re-opening Phase
  8.** None of the three trigger conditions can be measured today.
  Without APM, slow-query log, or `pg_stat_statements`, future
  re-evaluation will face the same evidence gap. Recommend adding a
  minimal Prisma `$on('query')` logger gated by an env flag (or
  enabling `pg_stat_statements` on the production Neon database)
  before treating Phase 8 as ready for another evaluation.
- **R4.2 (`runningBalance` race, medium severity) is *not* a Phase 8
  item.** Mentioned here because R4.1 (folio) is sometimes confused
  with it. R4.2 needs a `$transaction + SELECT … FOR UPDATE` or a
  recompute-on-read strategy; that's a separate scheduled fix, not an
  index migration.
- **Migration velocity caution.** Schema has 8 migrations in 4 days.
  Adding a speculative composite index now would compound migration
  history without measurable benefit and would still need
  `CREATE INDEX CONCURRENTLY` planning at deploy.

### Remaining work in Phase 8

**None for implementation.** The Phase 8 implementation queue is
empty until at least one of the documented future trigger conditions
fires.

Optional, *separate* workstream (not Phase 8 itself):

- **Observability bootstrap** — gated Prisma `$on('query')` logger or
  `pg_stat_statements` enablement so future Phase 8 re-evaluations
  have real data to consult.

---

## Recommended next step

Phase 8 has been **formally evaluated and deferred** — every roadmap
phase now has a recorded decision. The pagination + performance scope
(Phases 0–7) is fully closed; the hardening scope (Phase 8) is
deferred-with-triggers, not pending implementation.

The natural follow-up is **not another roadmap phase** but a small
observability bootstrap that closes the evidence gap that prevented
implementing Phase 8 today. Concretely:

1. **Bootstrap minimal DB observability** before any future Phase 8
   re-evaluation:
   - Add a Prisma `$on('query')` logger emitting durations above a
     threshold (e.g. 100 ms) behind a `PRISMA_QUERY_LOG=1` env flag,
     **or**
   - Enable `pg_stat_statements` on the Neon production database and
     wire a one-shot snapshot script under `scripts/` to dump the
     top-50 slowest statements weekly.
2. **Re-evaluate Phase 8 only when one of these signals fires**:
   - AuditLog: any tenant `audit_logs` row count > 500 k, **or**
     `findMany` p95 > 100 ms on `(condominiumId, createdAt)`-ordered
     pagination.
   - ImportBatch: dedup `findFirst` appears in the slow log, **or**
     any tenant exceeds ~100 import batches/day or ~250 k batch rows.
   - Petty-cash folio: first production `ConflictException('Could not
     generate unique folio after retries')` log entry, **or** any
     user-reported folio collision.

Carryover follow-ups outside the roadmap that can be scheduled
independently of Phase 8:

- **UI wiring**: replace `MOCK_COMMON_AREAS`, `MOCK_INVENTORY_ITEMS`,
  `MOCK_PETTY_CASH_MOVEMENTS` with live API consumers using the new
  envelope shape.
- **`reconciliation-rules.service.ts:12-37`** — flat shape sweep.
- **`ResidentsTable`** server-side pagination (Phase 5 web migration).
- **Overdue + resident-statement pages** (Phase 5 web migration).
- **R4.2 `runningBalance` race** — independent of Phase 8 folio
  decision; deserves its own treatment with `$transaction +
  SELECT … FOR UPDATE` or recompute-on-read.
- **Carryover bugs**: dashboard snake_case fallback raw query,
  ESLint v9 config migration, e2e harness bootstrap, `classifyBatch`
  snapshot equivalence test, P1.D R2 streaming uploads, P3.B
  background classification queue stretch.
