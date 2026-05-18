---
name: model-recommendation
description: Recommend the optimal Claude model (Opus 4.7, Sonnet 4.6, Haiku 4.5) for the current task based on complexity, scope, and cost. Invoke manually via /model-recommendation, natural language ("which model should I use?", "is Opus overkill for this?", "qué modelo me recomiendas"), or automatically via the UserPromptSubmit hook. Provides BRIEF justification (1-2 lines max) — token-efficient by design. Never burns more than ~100 tokens recommending.
---

# Model Recommendation Skill

Decide which Claude model best fits the task at hand and recommend it to the user — concisely.

## Objective

Match task complexity to model capability. Avoid using Opus 4.7 for trivial tasks (wasteful) and avoid using Haiku 4.5 for architectural work (low quality). Surface the recommendation in **1-2 lines max**.

## When to Use

**Manual triggers:**
- Slash command: `/model-recommendation`
- Natural language: "which model should I use?", "is Opus overkill?", "switch model?", "qué modelo me recomiendas", "cambio a otro modelo?", "this task is too big for Haiku?"

**Automatic trigger (hook):**
- The `UserPromptSubmit` hook at `hooks/classify-prompt.sh` runs on every prompt and injects an `additionalContext` block with the classification. When the active model substantially differs from the recommendation, surface a single-line suggestion to the user. Otherwise stay silent — never interrupt a flow that already fits.

**Skip entirely when:**
- The user is mid-flow on an approved plan
- The user has explicitly pinned a model for this session
- The active model already matches the recommendation

## Classification Process

Follow the heuristics in `references/classification-heuristics.md`. They classify any prompt into one of three buckets:

| Bucket | Recommended Model | Typical Tasks |
|---|---|---|
| **Trivial** | Haiku 4.5 | File ops, listing, simple lookups, typo fixes, short prompts (<60 chars) |
| **Standard** | Sonnet 4.6 | Feature implementation, refactors, bug fixes, component work |
| **Complex** | Opus 4.7 | Architecture, audits, multi-system planning, ambiguous problems |

Decision priority (apply in order):
1. **Domain signal** — does the prompt mention "architect", "audit", "design", "reconciliation", "migration strategy", "decide between"? → Complex.
2. **Trivial signal** — short prompt + simple verb (`rm`, `ls`, `cat`, "show", "qué es") + no design/refactor cues? → Trivial.
3. **Default** — everything else → Standard.

For full keyword lists, regex patterns, and edge cases, see `references/classification-heuristics.md`.

## Output Format (HARD LIMIT)

**Three lines max.** No prose around them. No headers. No bullet points.

```
Task: <trivial|standard|complex>
Recommend: <Haiku 4.5 | Sonnet 4.6 | Opus 4.7>
Why: <one sentence — name the signal that drove the call>
```

If the active model already matches, output one line only:
```
Active model fits this task — no change.
```

## Hard Rules

- **Token budget**: the recommendation itself must consume ≤100 output tokens. If you need more, you're doing too much.
- **No downgrade unless ≥30% savings**: see `references/cost-implications.md`. If switching from Opus to Sonnet on a borderline task saves trivial money, skip it.
- **Never interrupt mid-flow**: if the user is in plan mode, in a worktree, or working through an in-progress task list, stay silent.
- **One recommendation per session unless asked**: don't pester. After surfacing once, only re-surface if the user explicitly asks again.
- **Cite the signal**: the `Why` line must reference a concrete signal (a keyword, a length, a domain match), not vague reasoning.

## References

- [`references/model-matrix.md`](references/model-matrix.md) — domain × size → model lookup table
- [`references/classification-heuristics.md`](references/classification-heuristics.md) — regex patterns and decision rules
- [`references/cost-implications.md`](references/cost-implications.md) — pricing, savings thresholds
- [`references/invocation-examples.md`](references/invocation-examples.md) — 10 real-world prompts and the right answer

## Hook

The companion hook lives at `hooks/classify-prompt.sh`. It is wired into `~/.claude/settings.json` under `hooks.UserPromptSubmit`. It runs in bash (no LLM cost), reads the prompt from stdin as JSON (`{prompt: "..."}`), and emits `hookSpecificOutput.additionalContext` with the classification. The main loop reads that context and decides whether to surface a one-liner.
