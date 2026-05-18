# Code Quality — Best Practices

Aligned with Claude Code's default behavior (see the "Doing tasks" section of the system prompt) and with the CLAUDE.md conventions in the LivoClouds repos.

## The Big Five

### 1. Write no comments by default

- Well-named identifiers already explain WHAT the code does.
- Only add a comment when WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader.
- Never write multi-paragraph docstrings or "this function does X" comments.

**Bad:**
```ts
// Increment the counter
counter += 1;
```

**Good (when warranted):**
```ts
// Stripe webhooks deliver out of order; the +1 here matches the
// last-write-wins semantics agreed with the billing team (see RFC-42).
counter += 1;
```

### 2. Don't engineer for the hypothetical

- Three similar lines is better than a premature abstraction.
- Don't add config options "in case we need them later".
- Don't add feature flags or backwards-compat shims if you can just change the code.
- YAGNI is real. The next refactor is cheaper than the wrong abstraction.

### 3. Trust internal code

- Don't validate, error-handle, or check for `null` between functions in the same module that you control.
- Only validate at **system boundaries**: user input, external APIs, file parsing.
- Defensive code internal to a trusted module is noise.

### 4. Match the existing style

- The repo's existing patterns are the standard. Read 2-3 nearby files before introducing a new pattern.
- New abstractions need a real reason — a one-off doesn't justify a helper.
- Consistency > personal preference.

### 5. Name things precisely

- Variables: `paymentRuleId` > `id` > `x`.
- Functions: verb + noun: `classifyTransaction()` not `transaction()` or `process()`.
- Booleans: `isActive`, `hasPermission`, `shouldRetry` — questions you can answer yes/no.
- Avoid generic suffixes when specific words exist: `Manager`, `Handler`, `Helper`, `Util` — usually means you didn't pick a real name yet.

## Specific Anti-Patterns

### Don't write TODO comments
Either fix it or open an issue. TODO rot is the most common stale-code source.

### Don't reference the task or PR in comments
```ts
// Fix for issue #423 — added retry logic
```
This rots. The git blame and PR description have this context already.

### Don't add "removed because X" comments
```ts
// Removed authenticateUser() — moved to middleware
```
Just remove it. The git history shows the removal.

### Don't rename unused `_var` to keep type checking happy
If a variable is truly unused, delete it. Renaming is a workaround that adds clutter.

### Don't write `try/catch` to "be safe"
Catch where you can handle. Let exceptions propagate where you can't. Empty catches and "log and rethrow" patterns hide bugs.

## Tooling Rules

- **No `any` in TypeScript**: use `unknown` and narrow. `any` is a contract you've abandoned.
- **No `// @ts-ignore`** without a comment explaining why. `// @ts-expect-error` is preferred (errors when the underlying issue is fixed).
- **Prefer `const` over `let`**. `let` signals mutation, which is rare in well-written code.

## Comments That ARE Good

Reserve comments for these cases:
- **Non-obvious algorithm choice**: "Using insertion sort because n is bounded by 16."
- **External constraint**: "Stripe limits this to 100/sec; batching upstream."
- **Subtle invariant**: "transactionDate is always in tenant TZ, never UTC."
- **Workaround marker**: "Workaround for next-intl#3471 — remove after upgrade to v5."

## File / Module Structure

- One concept per file. If you can't name the file in 1-3 words, it's doing too much.
- Co-locate tests next to source: `foo.ts` and `foo.test.ts` in the same folder.
- Export the minimal surface. Internal helpers stay internal.
- Avoid `index.ts` re-export barrels that hide what's in a folder.

## Relationship to CLAUDE.md

This file gives **generic** code-quality guidance. Project CLAUDE.md (e.g., LivoClouds web app or API) gives **project-specific** rules: naming conventions for routes, tenant_id filtering, audit logging, etc.

**Project CLAUDE.md always wins over this file.** Use this as a fallback for things CLAUDE.md doesn't address.

---

**Sources**:
- The "Doing tasks" and "Tone and style" sections of Claude Code's default system prompt
- LivoClouds CLAUDE.md (project-specific conventions)
- General software engineering literature (Kernighan, Hunt & Thomas, Fowler)

_Last reviewed: 2026-05-17._
