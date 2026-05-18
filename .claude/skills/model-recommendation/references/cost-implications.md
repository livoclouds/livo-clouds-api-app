# Cost Implications

Approximate pricing (USD per 1M tokens, as of 2026-05). These guide the "should I downgrade?" decision.

## Pricing Snapshot

| Model | Input | Output | Cached read |
|---|---|---|---|
| **Opus 4.7** | $15 | $75 | $1.50 |
| **Sonnet 4.6** | $3 | $15 | $0.30 |
| **Haiku 4.5** | $1 | $5 | $0.10 |

> Verify current pricing at https://docs.anthropic.com/en/docs/about-claude/pricing before relying on these numbers for billing decisions.

## Savings Ratios

| From → To | Input cost ratio | Output cost ratio |
|---|---|---|
| Opus → Sonnet | 5x cheaper | 5x cheaper |
| Opus → Haiku | 15x cheaper | 15x cheaper |
| Sonnet → Haiku | 3x cheaper | 3x cheaper |

## Decision Rule

**Only recommend a downgrade if all three hold:**

1. The task fits the cheaper model per `model-matrix.md` (not a stretch fit).
2. The expected token volume × cost diff > ~$0.05 for the operation. (A single `rm` command on Opus costs <$0.001 — downgrading saves nothing meaningful.)
3. The user has not pinned the higher model for this session.

**Upgrade recommendations always trump downgrade recommendations.** If the task is being attempted on a model too weak for it, suggest upgrading even if the operation is small — quality matters more than cost on under-modeled tasks.

## Quick Calibration

| Operation scale | Worth recommending switch? |
|---|---|
| Single bash command, 1 file read | No (savings < $0.001) |
| Medium task: 5-10 tool calls, multi-file edits | Yes if mismatch by 1 tier |
| Long task: agents, large reads, multi-step plans | Yes always if mismatch — cost diff is real |

## Prompt Caching Note

If the session has a warm prompt cache (>1 message in the last 5 minutes), the cached-read column applies. Cache-hit Sonnet (~$0.30/M) is often cheaper than cache-miss Haiku (~$1/M). **Don't downgrade mid-session just to save tokens** — the cache miss on switch may cost more than the per-token savings.

---

_Last reviewed: 2026-05-17. Refresh pricing quarterly from docs.anthropic.com/pricing._
