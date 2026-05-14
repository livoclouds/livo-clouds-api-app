# API Review — Version Index

Living index for the LivoClouds API Performance & Risk Review history.
Each major review round lives in its own versioned, dated snapshot so
historical analysis stays immutable while the living progress tracker
for that round travels with it.

---

## Versions

| Version | Date | Scope | Status | Entry point |
|---------|------|-------|--------|-------------|
| **v1** | 2026-05-13 | Initial API Performance & Risk Review. 8-phase roadmap covering cleanups, dashboard SQL, transactions projection, background classification, pagination shape standardization, residents/overdue/statement pagination, collection-matrix pagination, calendar/inventory/petty-cash pagination, and an evidence-driven evaluation of index hardening. | **Phases 0–7 delivered (87.5%); Phase 8 evaluated and deferred (100% adjudicated).** | [`v1/2026-05-13/README.md`](./v1/2026-05-13/README.md) · [`v1/2026-05-13/progress/overall-progress.md`](./v1/2026-05-13/progress/overall-progress.md) · [`v1/2026-05-13/progress/overall-progress.html`](./v1/2026-05-13/progress/overall-progress.html) |

---

## Versioning convention

### Folder layout

```
docs/api-review/
├── README.md                          ← this file (always-living index)
└── <version>/                         ← e.g. v1, v2 — one folder per review round
    └── YYYY-MM-DD/                    ← snapshot/kickoff date for this round
        ├── README.md                  ← round-scoped overview, scope, methodology
        ├── endpoint-inventory.md      ← every endpoint, risk-tagged
        ├── performance-analysis.md    ← P-series findings (performance hot-paths)
        ├── risk-analysis.md           ← R-series findings (correctness/safety risks)
        ├── database-query-review.md   ← Q-series findings (Prisma patterns, indexes)
        ├── web-impact-review.md       ← cross-repo coordination matrix
        ├── implementation-roadmap.md  ← phased plan (the round's source of truth)
        ├── findings-summary.html      ← single-page visual companion
        └── progress/
            ├── overall-progress.md    ← living tracker for this round
            └── overall-progress.html
```

### Rules

- **`<version>/`** — one folder per major review round. `v1`, `v2`, `v3`, …
  - A *version* corresponds to a complete analysis pass over the API.
  - The version label is intentionally low-ceremony (no semver semantics).
- **`YYYY-MM-DD/`** — the date the round was kicked off (its inputs were frozen).
  - Each version contains exactly one dated snapshot today.
  - If a future round produces a major mid-cycle refresh of the analysis docs that warrants a new immutable baseline, a second dated snapshot can be added as a sibling folder inside the same `vN/`. This is not the current pattern.
- **Inside each `vN/YYYY-MM-DD/`** — frozen analysis artifacts + the round's living progress tracker live together. The 6 analysis docs + the `findings-summary.html` are *frozen byte-for-byte after the round starts*; only the `progress/` files mutate as the roadmap is implemented.
- **Closing a round** — when every phase in the round's roadmap is delivered (or formally deferred with a recorded decision), the round is closed by a final progress-tracker update. After close, the folder becomes effectively read-only.
- **Starting a new round** — copy the folder structure into `v(N+1)/YYYY-MM-DD/` with the new kickoff date. Never edit historical versions; the only commits that should touch a closed round are typo fixes or factual corrections.
- **Root `README.md`** — this file is the *only* always-living artifact outside any version folder. It is a thin index: one row per version, links to that version's entry points, and the convention documented above.

### Naming notes

- Version label: plain `vN`. If a round has a memorable codename (e.g. "security audit Q3 2026"), document it in the row's *Scope* column — but the folder stays `vN/YYYY-MM-DD/` for consistency.
- The date is the **kickoff date** of the round, not the close date. The close date is recorded inside the round's progress tracker.

---

## Why this layout

- **Immutable history** — anyone can read what was true at the start of v1 vs the start of v2, byte-identical to the original analysis.
- **Co-located tracking** — the living progress tracker for a round travels with that round's frozen analysis, so the implementation history of v1 is never confused with future rounds.
- **Cheap to extend** — a new round is `cp -r` of the previous version's skeleton with empty analysis docs, then re-baseline. No precedent ever has to move again.
- **No accidental overwrites** — the new round's frozen analysis cannot clobber v1's analysis because they live in separate folders.

---

## Cross-references

This index is the canonical entry point for the api-review history. The
analysis documents inside each version folder may reference each other
with paths *as they exist at the time of writing* (i.e. paths under
`v1/2026-05-13/...`). External code, runbooks, or other documentation
should link here first and let this index route them to the right
version.
