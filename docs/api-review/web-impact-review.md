# Web Impact Review

Cross-reference for every API change recommended in
`performance-analysis.md`, `risk-analysis.md`, and
`database-query-review.md`. For each change, identifies the affected
Next.js page/route in the web app and whether the change requires
coordinated work in `livo-clouds-web-app`.

The web app lives at
`/Users/hiperezr/Code/github/livoclouds/livo-clouds-web-app`. Citations
use the path conventions there.

---

## Coordination tags

- **API-only**: response shape preserved, web continues to work
  unchanged.
- **API+web (lockstep)**: response shape changes — both repos must
  ship in the same window. Web client wrappers, page components,
  and possibly URL state must update together.
- **API+web (rolling)**: API can deploy first with defaults that
  preserve current behavior; web migrates afterward at its own pace.

---

## Cross-reference matrix

| Finding | Recommended change | Affected web module / page | Web work | Tag |
|---|---|---|---|---|
| P1.1 (residents list unbounded) | Add `page`/`limit` + `q` + `paymentStatus` filter | Residents page; `src/lib/api/residents.ts` (`getResidents`); `/api/residents` proxy route | Pagination UI, search input, query-string state, table component | **API+web (rolling)** if default `limit=Infinity` preserved initially; otherwise lockstep |
| P1.2 (collection year matrix unbounded) | Paginate by resident range or stream | Collection page; `src/lib/api/collection.ts` (`fetchCollectionYear`); reports module | Matrix UI must handle paginated chunks or virtualized rows | **API+web (lockstep)** |
| P1.3 (resident account statement unbounded) | Default `from`/`to` to last 12mo; aggregate sums in SQL; paginate tx list | Resident statement page; `src/lib/api/collection.ts` (`fetchResidentAccountStatement`) | Date range filter visible in UI; pagination controls on the tx list | **API+web (rolling)** — defaults can preserve current behavior on first API release |
| P1.4 (overdue report unbounded) | Paginate + `q` + `minDebt` filter | Reports → Overdue page; `src/lib/api/reports.ts` (`fetchOverdueReport`) | Pagination UI + filter inputs | **API+web (rolling)** if defaults preserved |
| P1.5 (collection matrix report unbounded) | Same as P1.2 | Reports → Collection Matrix page; `src/lib/api/reports.ts` (`fetchCollectionMatrix`) | Same as P1.2 | **API+web (lockstep)** |
| P2.1 (dashboard trend in-memory) | Compute distinct paid residents per month in SQL | Dashboard page; `src/lib/api/dashboard.ts` (`fetchDashboardTrend`) — 60s ISR | None if response shape preserved | **API-only** |
| P2.2 (classifyBatch per-row update) | Batch UPDATE or move to queue | Imports page (batch confirm + reclassify) — endpoint response shape `{ total, classified, needsReview, unmatched }` preserved | None if response shape preserved; loading UX may improve | **API-only** |
| P3.1 (imports upload sequential) | Parallelize per-file pipeline; stream to R2; replace `console.log` with NestJS Logger | Imports upload page; `src/lib/api/imports.ts` indirectly via `/api/imports/upload` proxy | None if response shape preserved | **API-only** |
| P3.2 (petty-cash create race) | Retry on `P2002` or use sequence | Petty-cash form | None | **API-only** |
| P3.3 (transactions list deep includes) | Slim `select` projection on list | Transactions page; `src/lib/api/transactions.ts` (`fetchTransactions`, `fetchUnmatchedTransactions`) | None **if** the table renders only the slim fields; verify before shipping | **API+web (rolling)** — audit which web components read which fields |
| P3.4 (calendar list optional date range) | Require `from`/`to`; cap span | Calendar page; `src/lib/api/calendar.ts` (`getCalendarEvents`) — web already sends `from`/`to` today | None if web continues to send range | **API-only** (after web confirms it always sends range) |
| R3.2 (pagination shape inconsistency) | Standardize on `{ data, meta }` | Every paginated wrapper: `transactions.ts`, `imports.ts`, `dashboard.ts`, `reports.ts`, `collection.ts`, `residents.ts`, `audit` | All wrappers update to new shape simultaneously | **API+web (lockstep)** |
| R3.4 (unbounded → paginated is breaking) | Coordinate per-endpoint | All endpoints under P1.x + P3.4 + petty-cash + inventory | See per-finding rows | **API+web (rolling or lockstep — per finding)** |
| R4.3 (Excel parsing on web) | None (architectural note) | Imports module on web is source of truth | Watch for changes | **monitor** |
| R5.1 (`console.log` cleanup) | Replace with NestJS Logger | None | None | **API-only** |
| R5.2 (file buffering 100MB) | Stream to disk/R2 | None if response shape preserved | None | **API-only** |
| R5.3 (R2 upload errors swallowed) | Surface warning in response | Imports upload page should display warning when retention fails | Surface a warning chip / toast | **API+web (lockstep)** — response shape gains a `warnings` array per file |

---

## Detailed per-page consumption notes

### Residents page

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/residents/`
- **API endpoint**: `GET /condominiums/:slug/residents`
- **Web wrapper**: `src/lib/api/residents.ts` → `getResidents()` (dual
  fetch with `/api/settings/fees` to keep fees in sync)
- **Today**: web fetches full list, renders client-side table.
- **After P1.1**: web needs `page`, `limit`, optional `q`, optional
  `paymentStatus` query-string state. Table component switches to
  server-side paging. Dual-fetch with settings should be reviewed —
  fees can be cached separately.

### Collection page

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/collection/`
- **API endpoint**: `GET /condominiums/:slug/collection?year=Y`
- **Web wrapper**: `src/lib/api/collection.ts` → `fetchCollectionYear`
- **Today**: returns matrix shape (resident × 12 months) for the year.
- **After P1.2 / P1.5**: web must either virtualize the grid (no
  pagination, but client-side virtualization) or accept that the API
  returns paginated chunks and stitches client-side.

### Resident statement page

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/collection/residents/[id]/`
- **API endpoint**:
  `GET /condominiums/:slug/collection/residents/:id/account-statement`
- **Web wrapper**: `src/lib/api/collection.ts` →
  `fetchResidentAccountStatement`
- **Today**: returns `{ resident, transactions, collectionRecords,
  summary }` — full lists.
- **After P1.3**: response gains a `transactions.meta` pagination
  block; `summary` continues to reflect filtered totals. Web shows
  date-range selector; pagination on the tx list.

### Reports — Overdue & Collection Matrix

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/reports/`
- **API endpoints**: `/reports/overdue`, `/reports/collection-matrix`,
  `/reports/executive-summary`
- **Web wrappers**: `src/lib/api/reports.ts` →
  `fetchOverdueReport`, `fetchCollectionMatrix`,
  `fetchExecutiveSummary`
- **Today**: full lists for overdue and matrix; aggregated KPIs for
  executive summary.
- **After P1.4 / P1.5**: overdue gains pagination + filters; matrix
  same as Collection page.

### Dashboard

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/`
- **API endpoints**: `/dashboard`, `/dashboard/trend`
- **Web wrappers**: `src/lib/api/dashboard.ts` → `fetchDashboardKpis`,
  `fetchDashboardTrend`. Both use Next.js ISR with 60s revalidation.
- **After P2.1**: response shape preserved. ISR cache continues to
  work; cache invalidation behavior unchanged.

### Imports

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/imports/`
- **API endpoints**: `/imports`, `/imports/:id`, `/imports/upload`,
  `/imports/confirm`, `/imports/:id/classify`
- **Web wrappers**: `src/lib/api/imports.ts`,
  `src/app/api/imports/**/route.ts`
- **After P3.1**: response shape preserved. Web sees fewer client-side
  errors when R2 is temporarily unavailable (if R5.3 is also fixed).
- **After R5.3**: response gains `warnings` per file when storage
  retention fails; web must surface them.

### Transactions

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/transactions/`
- **API endpoint**: `/transactions` and variants
- **Web wrapper**: `src/lib/api/transactions.ts`
- **After P3.3**: web table component should be audited for which
  nested fields it actually reads. If `matchedCalendarEvent.resident`
  is only shown on row expand, the list response can drop it.
- **After R3.2 (pagination shape standardization)**: wrapper updates to
  read `data.meta.total` instead of `data.total`. Same for `imports`,
  `audit`, `dashboard`, `reports`, `collection`, `residents`.

### Calendar

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/calendar/`
- **API endpoints**: `/calendar/events` (list + CRUD)
- **Web wrapper**: `src/lib/api/calendar.ts`
- **After P3.4**: web already always sends `from`/`to` — verify before
  enforcement; minimal change.

### Inventory & Common areas

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/inventory/`
  (or similar — verify; web exploration noted these as full-list pages)
- **API endpoints**: `/common-areas`, `/inventory`
- **After Q1 (inventory pagination)**: web must add pagination
  controls; if filtering by `commonAreaId` is added, the page can
  scope items to one area at a time.

### Petty cash

- **Web path**: `src/app/[locale]/(app)/[condominiumSlug]/petty-cash/`
- **After Q1 (petty-cash pagination)**: same pattern.

---

## Coordination recommendation

Group the upcoming work into three release waves so the web app and API
do not drift:

**Wave 1 — Internal-only (API-only)**
- P2.1, P2.2, P3.1, P3.2, P3.3 (only if web audit confirms unused
  fields), P3.4, R5.1, R5.2, R5.5
- Web requires no changes; API ships independently.

**Wave 2 — Rolling (API ships with defaults preserving behavior, web
catches up)**
- P1.1 (residents), P1.3 (resident statement), P1.4 (overdue), R5.3
  (R2 warnings)
- API ships first with `limit=Infinity` (or a very high cap) defaulting
  to today's behavior; web migrates page-by-page over the following
  weeks.

**Wave 3 — Lockstep (both repos must ship in the same window)**
- P1.2 (collection year matrix), P1.5 (collection matrix report), R3.2
  (pagination shape envelope)
- Coordinate via a single PR pair (API + web) merged in the same
  release.

---

## Items the web does NOT need to know about

- All R6 acceptable-as-is items in `risk-analysis.md`
- All R4.4 (classification outside transaction) — already behaves as
  documented
- R5.1 / R5.2 / R5.5 — internal cleanups
- Index additions in `database-query-review.md` "Migration
  recommendations (deferred)" — DB-only changes
