# Skills KB — Reporting Contract

> **Single source of truth** for how any skill records a finding into the local,
> committed Skills Knowledge Base. Skills reference this file — they do **not**
> copy its logic. Lives at `~/.claude/skills/_shared/skill-kb/` and is propagated
> to each repo by `sync-skills-to-repos.sh`.

The KB exists so skills leave a **controlled, low-noise history** of what went
wrong or what could be better — so a maintainer/auditor skill can later spot
recurring problems, mark what's already fixed, and avoid re-correcting it.

Everything here is **local and ~0 tokens**: capture is a bash append, the store
is committed inside the repo at `.claude/skill-kb/`, no vault, no PR, no network.

---

## The gate — log ONLY when it's worth keeping (token discipline)

Record a finding **only** when one of these is true:

1. **Unrecoverable failure** — the skill hit a failure it has **no programmed way
   to retry or safely continue** from. (If the skill retried and recovered, that
   is NOT a finding.)
2. **A genuinely valuable, generalizable insight** — a limitation of the skill,
   an unhandled scenario, a missing validation, an opportunity, or a concrete
   future improvement — that will help future runs, **and** is **not already in
   the KB** (check with `lookup-finding.sh` first).

**Do NOT record:** normal/successful runs, routine progress, one-off facts, noise,
or anything already captured. **A session ending with zero findings is normal and
correct.** When in doubt, don't log — the cost of noise is real (tokens + a
polluted KB).

Before recording a fix-type insight, **always** `lookup-finding.sh` first:
- `UNKNOWN` → it's new, record it.
- `OPEN` → already tracked, do nothing.
- `RESOLVED` → it's a **regression**; recording it again reopens the same entry.

---

## Categories

| Field | Allowed values |
|---|---|
| `type` | `issue` · `unrecoverable-failure` · `limitation` · `opportunity` · `improvement` |
| `severity` | `low` · `medium` · `high` · `critical` |
| `status` | `open` · `resolved` · `wontfix` (managed by the scripts, not by you) |

## Canonical titles (this is what dedup keys on)

Write the `--title` as a **stable, descriptive statement of the problem**, not a
narration of this run. The fingerprint is derived from `skill + type +
normalized(title)`; paths, line numbers, and bare numbers are normalized away, so
the same problem coming back matches even with a different line number.

- ✅ `"guardian no detecta tenancy en controllers anidados"`
- ❌ `"el endpoint a veces falla en src/x.controller.ts:42"`

---

## How to record (one line — only after the gate passes)

```bash
bash ~/.claude/skills/_shared/skill-kb/report-finding.sh \
  --skill <this-skill-name> --type <type> \
  --title "<canonical problem statement>" \
  --severity high --evidence "src/.../file.ts:42" --note "<short why/context>"
```

## How to check before re-fixing

```bash
bash ~/.claude/skills/_shared/skill-kb/lookup-finding.sh \
  --skill <skill> --type <type> --title "<title>"     # -> OPEN|RESOLVED|WONTFIX|UNKNOWN <id>
```

## How to mark a finding fixed (records what / where / when)

```bash
bash ~/.claude/skills/_shared/skill-kb/report-finding.sh \
  --resolve <fingerprint> --what "<what was fixed>" --where "<file or PR>"
# `when` is stamped automatically. Use --wontfix <fp> --what "<reason>" to close w/o fixing.
```

---

## Guarantees (so you can call this freely)

- **Never blocks / never throws** — every error path exits 0. A logging failure
  can never disrupt the skill's real work.
- **Idempotent** — re-recording the same finding in the same state is a no-op.
- **Append-only & merge-friendly** — resolutions append a new line; the store is
  safe under parallel agents (a `mkdir` lock serializes writes).
- **Durable & shared** — `.claude/skill-kb/findings.jsonl` is committed and ships
  in the normal PR; `SKILL-KB.md` is its auto-generated human view (don't edit).

## For the reader/auditor

`skill-kb-review` queries `findings.jsonl` with `jq` (pre-filtered, so only the
relevant lines enter context), surfaces recurring/open findings, proposes
improvements, and calls `--resolve` when a fix lands.
