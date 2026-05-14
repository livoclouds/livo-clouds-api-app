# API Review — Overall Implementation Progress

**Last updated**: 2026-05-13 (UTC)
**Tracking source of truth**: `docs/api-review/implementation-roadmap.md`
**Companion HTML report**: [`overall-progress.html`](./overall-progress.html)

---

## Overall roadmap status

Phases 0, 1, 2, 3, and **4 — Pagination response shape standardization**
are **Complete**. Phase 4 was the first **API + web lockstep** phase
per `implementation-roadmap.md:99-118`. Paginated endpoints for
**transactions** (4 methods) and **imports** (1 method) now return
nested `{ data, meta: { total, page, limit, totalPages } }`; the
matching web type interfaces and 4 consumer tabs were updated in the
same window. Other paginated endpoints (residents, calendar, inventory,
petty-cash, common-areas, reconciliation-rules) remain flat until
Phases 5–7 per the roadmap. Audit endpoints were already nested
(unchanged). API `npm run build` + 65 unit tests pass; web `pnpm
typecheck` + `pnpm build` + 125 vitest tests pass. No schema change,
no endpoint path change, no envelope change, no tenant-isolation
change.

**Overall implementation**: 5 of 8 phases complete — **~62.5%**.

---

## Phase progress table

| Phase | Title                                                  | Status        |   % |
|------:|--------------------------------------------------------|---------------|----:|
| 0     | Cleanups (API-only, low risk)                          | **Complete**  | 100 |
| 1     | Dashboard trend SQL & imports parallelism              | **Complete**  | 100 |
| 2     | Transactions list projection + calendar range          | **Complete**  | 100 |
| 3     | Background classification                              | **Complete**  | 100 |
| 4     | Pagination response shape standardization              | **Complete**  | 100 |
| 5     | Paginate residents / overdue / resident statement      | Pending       |   0 |
| 6     | Paginate collection matrix                             | Pending       |   0 |
| 7     | Paginate calendar / inventory / common-areas / petty   | Pending       |   0 |
| 8     | Index hardening (DB migration, deferred)               | Pending       |   0 |

- **Current phase**: 4 (closed)
- **Completed phases**: 0, 1, 2, 3, 4
- **In-progress phase**: none
- **Pending phases**: 5, 6, 7, 8

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

## Recommended next step

Proceed to **Phase 5 — Paginate residents / overdue / resident statement** per `implementation-roadmap.md:121-141`. Phase 5 is rolling (API can ship first with a generous default `limit` so pre-migration web still works; web migrates per page). Pre-requisites: confirm the same nested `{ data, meta }` shape from Phase 4 will be the target for any newly-paginated endpoint (so we don't ship a second flat-shape regression). Suggested follow-ups to bundle when the time is right: include `reconciliation-rules.service.ts findAll` (currently out of scope but flat) in the same standardization sweep.
