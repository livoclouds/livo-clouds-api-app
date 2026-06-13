---
name: clean-architecture-guardian
description: Keep the livo-clouds-api NestJS codebase architecturally clean — enforce inward-pointing dependencies and clear layering (controller validates + delegates → service owns business logic → Prisma stays in services), module encapsulation (a module owns its providers; cross-service effects go through EventEmitter2 per ADR-010), DTO + ValidationPipe at every boundary, SOLID / single-responsibility (no god services), and function-level clean code (small focused units, clear names, no magic numbers, no `any`, no dead code, soft-delete filters, bounded Prisma queries). Auto-trigger — the Stop hook check-architecture.sh injects `[clean-architecture] block=true` listing files this turn that tripped a HARD violation (a controller touching Prisma directly, a new `any`, or a god-file), and Claude must run this skill before finishing. Proactive — the UserPromptSubmit hook detect-architecture-intent.sh nudges these rules BEFORE code is written. Manual triggers — /clean-arch, English ("review the architecture", "is this clean code", "check the layering", "any SOLID violations"), Spanish ("revisa la arquitectura", "¿es código limpio?", "revisa las capas", "¿hay violaciones SOLID?"). Pairs with api-endpoint-guardian (endpoint security + i18n error keys); defers that turf to it.
---

# Clean Architecture Guardian (API)

Closes the recurring gap where touched NestJS code drifts from the LivoClouds API
architecture — a controller reaching into `PrismaService` instead of delegating to a
service, business logic bleeding into the HTTP layer, an `any` eroding type-safety,
a service quietly growing into a 900-line god-module, or a cross-module side effect
bypassing the event bus. Dependencies point inward: controllers are thin, services
own the rules, Prisma lives in services.

This skill is the model half of a hook+skill pair. The deterministic half lives in
`hooks/`:

- `hooks/detect-architecture-intent.sh` (UserPromptSubmit) — on an implementation
  prompt, injects a one-line reminder of the layering + clean-code rules so they
  apply *before* you write.
- `hooks/track-architecture.sh` (PostToolUse) — records every changed
  `src/**/*.ts` (excluding specs/decls) to
  `.claude/.cache/clean-architecture/<session_id>.touched`.
- `hooks/check-architecture.sh` (Stop) — blocks once per file, but **only on the
  HARD set** (hybrid enforcement). That block is your cue to run the full review.

## Hybrid contract — what the hook hard-blocks vs. what you review

The hook is deliberately quiet. It hard-blocks **only** unambiguous violations:

- **Layering leak** — a `*.controller.ts` referencing `PrismaService` / `this.prisma`
  directly. Controllers validate input and delegate; data access lives in services.
- **New `any`** — a `: any` / `as any` added this turn (type-safety erosion).
- **God file** — a touched file over ~500 lines.

Everything subtler is **your judgment call** in the protocol below — the hook does
not block on it, but you review it whenever this skill runs.

## When to run

- **Auto:** you received a `[clean-architecture] block=true` reason at Stop. Fix the
  HARD violations it lists, then run the full checklist on the same files.
- **Manual:** the user typed `/clean-arch` or asked in natural language. Scan
  `git diff` for changed `src/**/*.ts`.

## Protocol

1. **Build the target set** (files from the block reason, or `git diff`).

2. **For each file, check architecture (judgment):**
   - **Layering** — controller: validate (DTO) + delegate, no business logic, no
     Prisma. Service: owns business rules + Prisma access. No `PrismaService` in
     controllers; no HTTP concerns (`@Res`, status codes) leaking into services.
   - **Module encapsulation** — a module owns and exports its own providers; don't
     reach into another module's internals. Need another module's provider? Import
     the module that exports it.
   - **Cross-service side effects** — fire through `EventEmitter2` (ADR-010), not a
     direct call into another module's service, to avoid tight coupling/cycles.
   - **Boundary validation** — every `@Body()` / `@Query()` uses a class-validator
     DTO; the global `ValidationPipe` (whitelist + transform) does the rest.
   - **SOLID** — single responsibility per service/method; depend on injected
     abstractions; no god service doing five unrelated jobs.

3. **For each file, check clean code (judgment):**
   - **Small focused units** — split methods/services that do too much; flag deep
     nesting and long parameter lists.
   - **Clear names** — no `handle`/`process`/`data2`/`tmp`; names state intent.
   - **No magic numbers/strings** — extract to named constants / config.
   - **No `any`** — use a real type, `unknown` + narrowing, or a generic.
   - **No dead code** — unused providers/params/branches; stale commented code.
   - **Data-access hygiene** — filter soft-deletes (`deletedAt: null`) where the
     model has them; never expose `passwordHash` (use the service's `safeSelect`);
     no unbounded queries (use `select`/`include` + pagination).

4. **Decide per file:** CLEAN, or REFACTOR (state which rule + the file:line). Apply
   the fix when asked; keep changes behavior-preserving and run `npm run typecheck`.

5. **Report** — emit a summary table:

   | File | Layering | Module-enc | SOLID | `any`-free | Clean code | Verdict |
   |---|---|---|---|---|---|---|
   | `modules/x/x.controller.ts` | ⚠ Prisma | ✅ | ✅ | ✅ | ✅ | REFACTOR |

## Guardrails

- **Behavior-preserving** — refactors must not change behavior; re-run
  `npm run typecheck` (nest build skips spec typecheck) and the module's specs.
- **Don't double-enforce** — endpoint security (`@UseGuards`/RBAC) and i18n error
  KEYS are owned by `api-endpoint-guardian`; defer to it for those. This skill owns
  layering, module boundaries, SOLID, and clean code.
- **Hybrid, low-friction** — only the HARD set blocks. Don't manufacture blocking
  findings; advise on the rest.
- **Opt-out:** the user can set `CLEAN_ARCH_OFF=1` (or `touch
  .claude/.cache/clean-architecture/OFF`) to skip the nudge this turn.

## Skills KB reporting

Only on an **unrecoverable failure** or a **valuable, generalizable** finding
(never on normal/successful runs), check-then-record via
`~/.claude/skills/_shared/skill-kb/{lookup,report}-finding.sh --skill <name>`.
Full gate, types, and resolve rules: `~/.claude/skills/_shared/skill-kb/CONTRACT.md`.
