---
name: anthropic-best-practices
description: Apply Anthropic's official best practices across 4 domains — token efficiency, Claude Code patterns, prompt engineering, and code quality. Invoke via /anthropic-best-practices or natural language ("best practices", "buenas prácticas", "ahorro de tokens", "cómo optimizo este prompt", "patrón recomendado"). Curated static reference — load ONLY the relevant domain file, never all four at once.
---

# Anthropic Best Practices Skill

A curated, token-efficient reference distilled from Anthropic's official documentation (`docs.anthropic.com`, `docs.claude.com/claude-code`, Anthropic engineering blog). Organized into 4 single-domain files so you load only what's relevant.

## Objective

Give Claude Code a quick, authoritative reference for "how should I do this?" questions across four high-leverage domains, without burning tokens on a monolithic document.

## When to Use

**Triggers:**
- Slash command: `/anthropic-best-practices` (or `/best-practices`)
- Natural language: "best practices for X", "buenas prácticas", "ahorro de tokens", "how do I save tokens", "cómo optimizo este prompt", "patrón recomendado para X"
- Implicit: when about to do something expensive (re-read large files, deep agent chain, ambiguous prompt) — consult the relevant domain file first.

**Skip when:**
- The user already specified their approach and just wants execution.
- A more specific skill (e.g., `vercel:react-best-practices`) covers the same ground.

## Domains

| Domain | File | When to consult |
|---|---|---|
| **Token efficiency** | [`references/token-efficiency.md`](references/token-efficiency.md) | Long sessions, repeated reads, big files, subagent decisions, caching, parallel tool calls |
| **Claude Code patterns** | [`references/claude-code-patterns.md`](references/claude-code-patterns.md) | Skills, hooks, plan mode, agents, worktrees, `/memory`, CLAUDE.md hierarchy |
| **Prompt engineering** | [`references/prompt-engineering.md`](references/prompt-engineering.md) | Writing prompts for agents, system prompts, structured output, chain-of-thought |
| **Code quality** | [`references/code-quality.md`](references/code-quality.md) | Naming, no over-engineering, comments-WHY-only, error handling philosophy |

## How to Use

1. **Identify the domain** from the user's question or the task at hand.
2. **Load ONLY that one file.** Do not load multiple references unless the user explicitly asks for a cross-domain comparison.
3. **Cite the source** when applying a rule: e.g., "Per `references/token-efficiency.md`, batch parallel tool calls in one message."
4. **Be concrete**: don't paraphrase. Quote the rule and apply it.

## Hard Rules

- Never load all 4 reference files at once. ~6-10 KB each — context budget burned for no reason.
- The skill itself stays minimal. The references hold the depth.
- When a reference contradicts CLAUDE.md of the active repo, **CLAUDE.md wins** (project context overrides generic guidance).
- Always check the "Last reviewed" date at the bottom of each reference. If >6 months old, flag to the user that a refresh may be needed.

## Maintenance

This skill uses **static curated content**. To refresh:

1. Open each reference file
2. Visit the source URLs listed at the bottom
3. Update any changed guidance, then bump the "Last reviewed" date
4. Cadence: every ~3 months, or after a major Anthropic platform release

Source URLs to monitor:
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- https://code.claude.com/docs/en/overview
- https://www.anthropic.com/engineering (blog)
