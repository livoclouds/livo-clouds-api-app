# Claude Code Patterns — Best Practices

Distilled from `code.claude.com/docs` and the Anthropic engineering blog. Focus: features unique to Claude Code that high-leverage users underuse.

## Skills

- **Format**: `<dir>/SKILL.md` with YAML frontmatter (`name`, `description`) + body. Optional `references/` folder for depth.
- **Activation**: matched by `description` field against user prompts. Be specific: include trigger keywords/phrases.
- **Keep SKILL.md small**: ~2-5 KB. Push depth into `references/`.
- **One concern per skill**: a skill that "does everything" never activates correctly.
- **Lazy loading**: references are only loaded when the skill body says to. Don't dump them all into SKILL.md.

## Hooks

- Configured in `~/.claude/settings.json` (user) or `<project>/.claude/settings.json` (project). Use **user-level for cross-project** behavior.
- Schema: `hooks.<EventName>[].hooks[].{type, command}`. `UserPromptSubmit` does NOT support matchers; it fires on every prompt.
- Stdout from a hook (exit 0) is injected into Claude's context. For structured control, output JSON with `hookSpecificOutput.additionalContext`.
- Exit codes: `0` = success (stdout becomes context), `2` = block (stderr shown to user, prompt not processed), other = non-blocking error.
- **Keep hooks fast** (default timeout 30s for `UserPromptSubmit`). Use bash, not LLM calls, for classification.
- See https://code.claude.com/docs/en/hooks for full schema.

## Plan Mode

- Triggered by `EnterPlanMode` or the user invoking `/plan`. In plan mode you can only read and write to the plan file.
- Use it for: non-trivial implementations, ambiguous tasks, anything multi-file.
- Skip for: typo fixes, one-line changes, pure research.
- Always end with `ExitPlanMode` (which requests user approval) or `AskUserQuestion` (to clarify before approval).
- **Never** ask "is this plan ok?" in text — use `ExitPlanMode`.

## Agents (Explore, general-purpose, specialized)

- `Explore`: read-only, fast, for "find/locate" tasks. Specify breadth ("quick", "medium", "very thorough").
- `general-purpose`: full toolset, for open-ended research or multi-step tasks where you need code changes.
- **Specialized agents** (e.g., `vercel:deployment-expert`): use when description matches the task domain.
- **Cold start cost**: each agent invocation starts a fresh context. Brief them like a smart colleague who walked in: goal, what you've ruled out, what specifically to do.
- **Don't delegate synthesis**: write prompts that prove you understood. Include file paths, exact instructions — not "based on findings, implement it".

## Worktrees

- `EnterWorktree` creates a temporary git worktree at `.claude/worktrees/<branch>/`. Isolates your work from other parallel jobs and the user's working copy.
- Use when making code changes in a background job (parallel jobs share the same repo otherwise).
- Skip when: only reading, only answering questions, or already in a worktree.
- `ExitWorktree` returns to the original cwd. The agent-git-finalize skill handles the full lifecycle.

## Memory & CLAUDE.md hierarchy

Three layers, loaded automatically into context:
1. **`~/.claude/projects/<project>/memory/`** — your persistent auto-memory (user prefs, project context, feedback).
2. **Project `CLAUDE.md`** — repo-level instructions checked into git.
3. **Subdirectory `CLAUDE.md`** — module-specific overrides (loaded only when cd'd into that dir).

Rules:
- `MEMORY.md` is an index, one line per memory. Memories themselves live in adjacent files.
- Don't duplicate what's in CLAUDE.md into memory.
- Don't save ephemeral state (in-progress task notes) into memory — that's what TaskList is for.

## Slash Commands & Skills are the Same Thing

When the user types `/foo`, Claude Code looks for a skill named `foo`. The slash invocation is just a deterministic trigger; natural language activation also works if the `description` field matches.

## TaskList for Multi-Step Work

- Use `TaskCreate` when work has ≥3 distinct steps.
- Mark `in_progress` BEFORE starting (one task at a time).
- Mark `completed` immediately when done — don't batch.
- Don't use for trivial 1-2 step work.

## Common Mistakes

- **Loading all skill references upfront**: skills are designed to lazy-load. Read SKILL.md first, then load only the references it points you to.
- **Using `Agent` for one-shot lookups**: if you know the file path, `Read` is cheaper. Agents have cold-start overhead.
- **Hooks that call an LLM**: defeats the point. Hooks should be sub-second bash/JS.
- **Putting business logic in CLAUDE.md**: CLAUDE.md is for invariants and pointers. Logic belongs in the code, references belong in `docs/`.

---

**Sources**:
- https://code.claude.com/docs/en
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/skills
- https://www.anthropic.com/engineering

_Last reviewed: 2026-05-17._
