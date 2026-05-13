# API Review — Overall Implementation Progress

**Last updated**: 2026-05-13 (UTC)
**Tracking source of truth**: `docs/api-review/implementation-roadmap.md`
**Companion HTML report**: [`overall-progress.html`](./overall-progress.html)

---

## Overall roadmap status

Phase 0 — Cleanups is **Complete**. All three Phase 0 tasks were applied,
build passes, unit tests pass, and no API contract or web-impact change
was introduced.

**Overall implementation**: 1 of 8 phases complete — **~12.5%**.

---

## Phase progress table

| Phase | Title                                                  | Status      |   % |
|------:|--------------------------------------------------------|-------------|----:|
| 0     | Cleanups (API-only, low risk)                          | **Complete**| 100 |
| 1     | Dashboard trend SQL & imports parallelism              | Pending     |   0 |
| 2     | Transactions list projection + calendar range          | Pending     |   0 |
| 3     | Background classification                              | Pending     |   0 |
| 4     | Pagination response shape standardization              | Pending     |   0 |
| 5     | Paginate residents / overdue / resident statement      | Pending     |   0 |
| 6     | Paginate collection matrix                             | Pending     |   0 |
| 7     | Paginate calendar / inventory / common-areas / petty   | Pending     |   0 |
| 8     | Index hardening (DB migration, deferred)               | Pending     |   0 |

- **Current phase**: 0 (closed)
- **Completed phases**: 0
- **In-progress phase**: none
- **Pending phases**: 1, 2, 3, 4, 5, 6, 7, 8

---

## Phase 0 task breakdown

- [x] **P0.1** — Replace `console.*` with NestJS `Logger` in `src/modules/imports/imports.service.ts`
  - 13 calls replaced (12 `console.log` → `this.logger.log`, 1 `console.error` → `this.logger.error` with stack).
  - Added `Logger` to the existing `@nestjs/common` import and instantiated `private readonly logger = new Logger(ImportsService.name)`.
  - Redundant `[ImportsService]` message prefix dropped (Nest's `Logger` adds the context automatically).
- [x] **P0.2** — Verified `@Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 20, ttl: 60_000 } })` is applied on `POST transactions/bulk-reconcile` at `src/modules/classification/classification.controller.ts:146-150`. **No code change required.**
- [x] **P0.3** — Wrapped the Swagger registration block in `src/main.ts` behind `if (process.env.NODE_ENV !== 'production')`. In production, `/docs` now returns 404; dev/staging/testing behavior is unchanged.

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

## Validation performed

| Command | Result | Notes |
|---|---|---|
| `npm run build` | **PASS** | `nest build` ran clean; TypeScript compiled. |
| `npm test` | **PASS** | 2 suites, 65 tests passed (terrace-booking-matcher + terrace-metadata.validator). |
| `npm run lint` | **FAIL (pre-existing)** | ESLint 9.39.4 expects `eslint.config.js`; repo still has legacy `.eslintrc.*` format. **Not introduced by Phase 0.** Logged as repo-level migration debt outside this scope. |
| `npm run test:e2e` | **SKIPPED** | `test/` folder does not exist in the repo; e2e harness not configured. |

**Manual checks (all PASS)**:

- `grep -n "console\." src/modules/imports/imports.service.ts` → 0 hits.
- `grep -cn "this.logger\." src/modules/imports/imports.service.ts` → 13.
- `grep -n "@Throttle" src/modules/classification/classification.controller.ts` → line 148.
- `grep -n "NODE_ENV" src/main.ts` → line 42 (`if (process.env.NODE_ENV !== 'production')`).
- `git status` in the API repo → only the 4 files listed above are dirty.
- `git status` in the web repo → no related changes (only the pre-existing untracked `tsconfig.tsbuildinfo`).

---

## Risks / blockers detected

- **Pre-existing lint config issue** (ESLint v9 vs legacy `.eslintrc`). Will not block Phase 0 because it is unrelated to the changes here. Recommended to address as part of a future "repo hygiene" pass.
- **No e2e harness yet**. Documented above; the manual smoke checks (grep + git status + build + unit tests) act as the validation surface for Phase 0.

---

## Impact status

| Dimension          | Status | Detail |
|--------------------|--------|--------|
| Web app changes    | **None required** | No proxy route, page, or wrapper change. |
| API contract       | **Unchanged** | Response envelopes, routes, error shape preserved. The only behavioral delta is `/docs` returning 404 in production. |
| Database / Prisma  | **Unchanged** | Schema, migrations, queries untouched. |
| Tenant isolation   | **Unchanged** | Guards, JWT, RBAC untouched. |
| AuthN / AuthZ      | **Unchanged** | No identity-layer code touched. |

---

## Remaining work in Phase 0

**None.** Phase 0 is complete.

---

## Recommended next step

Proceed to **Phase 1 — Dashboard trend SQL & imports parallelism (API-only)** per the roadmap. Phase 1 tasks:

- P2.1 / Q5 — Move per-month distinct-paid-resident count to SQL `GROUP BY` in `dashboard.service.ts:84-153` (medium risk; requires correctness check).
- P3.1 / Q6 — Parallelize per-file dedup lookups in `imports.upload`; batch with `findMany({ where: { fileHash: { in: [...] } } })` (low risk).
- P3.2 / R4.1 — Add retry-on-`P2002` to petty-cash create (low risk).
- Optional: Stream uploads to R2 instead of buffering up to 100 MB (medium risk).

Phase 1 is API-only — no web work is required.
