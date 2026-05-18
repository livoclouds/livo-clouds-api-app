# Token Efficiency — Best Practices

Distilled from `docs.anthropic.com/en/docs/build-with-claude/prompt-caching`, Claude Code documentation, and the Anthropic engineering blog.

## The Big Five

These five give 80% of the wins. Apply them by default.

### 1. Prompt caching is free money — use it

- The Anthropic API auto-caches **system prompt + initial conversation** with a 5-minute TTL.
- Cached read is **~10x cheaper** than fresh input.
- Implication: **don't sleep past 270s** if you can avoid it. After 300s the cache expires; you pay full price on the next message.
- For SDK callers: set `cache_control: { type: "ephemeral" }` on stable prompt prefixes (system prompts, long instructions, large reference docs). Cache hits cost $0.30/M (Sonnet) vs $3/M for fresh input.

### 2. Batch parallel tool calls in ONE message

- When two tool calls have no dependency (e.g., `git status` + `git diff`), issue **both in the same response** as parallel tool calls.
- Each turn costs full context replay. Two sequential turns = 2x input tokens vs. one turn with two tool calls.
- Rule of thumb: if call B doesn't need call A's result, parallelize.

### 3. Delegate noisy investigation to subagents

- Reading 30 files yourself = 30 files in YOUR context forever.
- Spawn an `Explore` agent (read-only, fast) and ask for a **summary**. The agent's context dies when it returns — only the summary persists in yours.
- Use for: codebase surveys, "where is X defined", grep sweeps, log trawls, "find all callers of Y".
- DO NOT use for: tasks you'll need to iterate on (you lose the agent's working memory each call).

### 4. Don't re-read what you just edited

- Claude Code's `Edit` and `Write` track file state. If you edited a file successfully, the change is in your context. **Re-reading is wasted tokens.**
- Same for `Read` results in the current turn — once read, they're in context.

### 5. Use the right model

- Opus on `rm -rf temp/` is ~15x overcost. Haiku on architectural design produces low-quality output. See the companion skill `model-recommendation`.
- For repeated cheap calls (single-file edits, lookups), consider switching the session to a cheaper model.

## Secondary Wins

- **Compact prompts for agents**: agents start cold. Brief them in 3-5 sentences, not 30. Include only what they need (file paths, exact question, constraints).
- **Avoid context bloat**: don't paste 500-line files into prompts if the agent can read them from disk.
- **Use `select:` queries in ToolSearch**: when you know the tool name, `select:ToolName` is one-shot vs keyword search which returns 5 candidates.
- **Skip narration of internal deliberation**: thinking is free; saying "let me think about this" out loud is not.

## Anti-Patterns

- **Polling background work in a sleep loop** — when a background task finishes you're notified automatically. Sleeping wastes the cache.
- **Re-asking the user the same question** — if they already answered, the answer is in your context.
- **Loading large reference files preemptively** — load lazily, only when needed.
- **Asking subagents for "step-by-step plans"** — they re-derive everything cold. Hand them the plan you already have.

## Quick Reference

| Action | Cost | Alternative |
|---|---|---|
| Sequential tool calls (2 turns) | 2x context | Parallel tool calls (1 turn) |
| Reading 20 files in main loop | 20x file content in context | Explore agent → summary |
| Re-reading after Edit | full file again | Just don't |
| Opus for `ls` | $15/M input | Haiku at $1/M |
| Sleep 350s (cache miss) | full uncached input | Sleep 270s (cache warm) |

---

**Sources** (visit to refresh):
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- https://www.anthropic.com/engineering (search: "context", "agents", "caching")
- https://code.claude.com/docs/en/overview

_Last reviewed: 2026-05-17._
