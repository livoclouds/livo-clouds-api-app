---
name: skill-kb-review
description: Read the local Skills Knowledge Base (.claude/skill-kb/findings.jsonl) to surface recurring problems, unresolved limitations, and improvement opportunities recorded by other skills — then propose concrete fixes and, when a fix lands, mark the finding resolved (what/where/when). Token-cheap by design — pre-filters with jq so only the relevant findings enter context, never the whole file. Invoke ONLY when the user explicitly asks via /skill-kb-review or natural language ("revisa el KB de skills", "qué problemas recurrentes tienen los skills", "review the skills knowledge base", "what should we improve in the skills", "audita los hallazgos de los skills"). Never auto-trigger.
---

# Skills KB Review

Closes the loop on the Skills Knowledge Base. Other skills record valuable findings
(unrecoverable failures, limitations, missing validations, opportunities, improvements)
into a local, committed store via `report-finding.sh` — see the contract at
`~/.claude/skills/_shared/skill-kb/CONTRACT.md`. This skill **reads** that store to find
patterns and recurring pain, proposes improvements, and **resolves** entries when a fix
is shipped so the same issue is never re-corrected.

It is the maintenance/audit counterpart to the capture utility. It does **not** capture
findings itself (skills do that as they run) — it consumes them.

## When to run

Manual only — `/skill-kb-review` or an explicit natural-language ask. Never auto-trigger,
never run as a side effect of another skill.

Scope can be narrowed by the user: a single skill (`/skill-kb-review test-sync-guardian`),
a type, or "everything open". Default scope = all open + regression findings in the
current repo's store.

## Token discipline (this is the whole point)

**Never read `findings.jsonl` wholesale into context.** Always pre-filter with `jq` in
Bash and bring back only the lines that matter — the recipes in
`references/query-recipes.md` do exactly this (open-only, group-by-skill, recurrence
counts, regressions). The KB is the source of truth; jq is the cheap lens.

## Procedure

1. **Locate the store.** It's `<repo-root>/.claude/skill-kb/findings.jsonl` (or
   `~/.claude/skill-kb/findings.jsonl` for global-skill findings). If it doesn't exist or
   has no open findings → say so in one line and stop. Nothing to do is a valid outcome.
2. **Query, don't slurp.** Run the relevant recipe(s) from `references/query-recipes.md`
   to pull: open findings grouped by skill, recurrence/regression hot-spots, and the
   highest-severity items. Only those lines enter context.
3. **Read the targeted skill(s).** For the findings worth acting on, open the named
   skill's `SKILL.md`/scripts to understand the actual limitation. Code > the finding's
   text — if the running skill already handles it, the finding is stale (mark resolved).
4. **Propose.** Present a prioritized, deduped list: recurring patterns first, then
   high-severity open items, then opportunities. For each: what it is, which skill owns
   it, evidence, and a concrete fix or improvement. Follow `references/output-format.md`.
5. **Resolve what's fixed.** When a fix is applied in this session (or you confirm a
   finding is already handled by current code), close it — see below. Never silently drop
   an entry.

## Resolving findings (what / where / when)

When a finding is fixed or confirmed obsolete, record the resolution so future runs skip
it (requirement: never re-correct a resolved issue):

```bash
bash ~/.claude/skills/_shared/skill-kb/report-finding.sh \
  --resolve <fingerprint> --what "<what was fixed>" --where "<file or PR>"
# `when` is stamped automatically. Use --wontfix <fp> --what "<reason>" to close without a fix.
```

Get the `<fingerprint>` from the `fp` field of the finding (visible in the jq output and
in `SKILL-KB.md`). After resolving, `SKILL-KB.md` regenerates automatically.

## Guardrails

- **Read-cheap, always** — jq-filter first; never dump the whole store into context.
- **Code > KB** — if current code already handles a finding, it's stale → resolve it,
  don't propose a redundant fix.
- **Don't re-open by hand** — regressions are detected automatically by the capture path;
  this skill only resolves/wontfixes.
- **No noise back into the KB** — this skill reads and resolves; it does not record new
  findings (the skills that hit the problems do that).
- **Append-only store** — resolutions append a line; never hand-edit `findings.jsonl` or
  `SKILL-KB.md`.
