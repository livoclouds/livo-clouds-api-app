# Model Matrix — Domain × Size → Recommended Model

Authoritative lookup table for the `model-recommendation` skill.

> Models (current as of 2026-05): **Opus 4.7** (`claude-opus-4-7`) · **Sonnet 4.6** (`claude-sonnet-4-6`) · **Haiku 4.5** (`claude-haiku-4-5-20251001`).

## How to Read

Rows = task domain. Columns = task size (rough lines-of-code or files touched).

| Domain \ Size | XS (1 file, <10 LOC) | S (1-3 files, <100 LOC) | M (3-10 files, <500 LOC) | L (10+ files, ambiguous) | XL (cross-repo, architectural) |
|---|---|---|---|---|---|
| **Typo / formatting** | Haiku | Haiku | Haiku | Haiku | Haiku |
| **File ops (rm, mv, ls)** | Haiku | Haiku | Sonnet | Sonnet | Opus |
| **Lookups / Q&A about code** | Haiku | Haiku | Sonnet | Sonnet | Opus |
| **Bug fix (well-scoped)** | Haiku | Sonnet | Sonnet | Sonnet | Opus |
| **Bug fix (unclear root cause)** | Sonnet | Sonnet | Opus | Opus | Opus |
| **Feature implementation** | Sonnet | Sonnet | Sonnet | Opus | Opus |
| **Component / UI work** | Sonnet | Sonnet | Sonnet | Opus | Opus |
| **Refactor (mechanical)** | Sonnet | Sonnet | Sonnet | Sonnet | Opus |
| **Refactor (judgment-heavy)** | Sonnet | Sonnet | Opus | Opus | Opus |
| **Test writing** | Haiku | Sonnet | Sonnet | Sonnet | Opus |
| **Code review / audit** | Sonnet | Sonnet | Opus | Opus | Opus |
| **Architecture / system design** | Opus | Opus | Opus | Opus | Opus |
| **Migration strategy** | Sonnet | Opus | Opus | Opus | Opus |
| **Multi-tenant isolation analysis** | Opus | Opus | Opus | Opus | Opus |
| **Security review** | Opus | Opus | Opus | Opus | Opus |
| **Docs / explanations (recap)** | Haiku | Haiku | Sonnet | Sonnet | Opus |
| **Docs (new architectural)** | Sonnet | Sonnet | Opus | Opus | Opus |

## Tiebreakers

When a task spans two cells (e.g., "feature + audit"), pick the higher model.

When in doubt between two adjacent cells, prefer the **cheaper** one — only upgrade if the first attempt produces low-quality output.

## Anti-patterns

- **Opus for `rm -rf` or `ls`** → always wrong, recommend Haiku.
- **Haiku for "design the auth flow"** → always wrong, recommend Opus.
- **Sonnet for "write a 5-line utility"** → wasteful, recommend Haiku.

---

_Last reviewed: 2026-05-17. Refresh when model lineup changes._
