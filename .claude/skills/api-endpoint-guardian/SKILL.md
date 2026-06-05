---
name: api-endpoint-guardian
description: Enforce endpoint security and error-localization conventions in the livo-clouds-api-app (NestJS). When a controller or service under src/modules is created or changed, verify exceptions throw an i18n KEY ('domain.errors.key') rather than plain prose, every endpoint serving tenant data is protected by @UseGuards(CondominiumAccessGuard) (or documented public), and DTOs are validated (class-validator + global ValidationPipe). Auto-trigger — the Stop hook check-endpoints.sh injects `[api-endpoint] block=true` listing files that deviate this turn, and Claude must run this skill before finishing. Manual triggers — /api-guard, English ("check the endpoints", "is this controller secure", "audit the api conventions"), Spanish ("revisa los endpoints", "¿es seguro este controller?", "audita las convenciones de la api"). This repo uses Jest + npm (never Vitest).
---

# API Endpoint Guardian (NestJS)

Brings the proven hook+skill guardian pattern to the API repo, which previously had
no skills or hooks. It closes two recurring gaps found across modules:

1. **Plain-English exceptions** — e.g. `throw new NotFoundException('Transaction not
   found')` or `throw new Error('Resident not found in this condominium')`. The web
   localizes API error **keys** via `useErrorMessage()`; prose leaks untranslated.
   Compliant form: `throw new NotFoundException('transactions.errors.notFound')`.
2. **Inconsistent route guards** — most controllers use
   `@UseGuards(CondominiumAccessGuard)` (23 usages), but some route controllers
   declare endpoints with none. Tenant-data endpoints must be guarded.

The deterministic half lives in `hooks/`:

- `hooks/track-endpoints.sh` (PostToolUse) records changed
  `src/modules/**/*.{controller,service}.ts` to
  `.claude/.cache/api-endpoint/<session_id>.touched`.
- `hooks/check-endpoints.sh` (Stop) flags a plain-English throw (string literal with
  a space) and a route controller with no `@UseGuards` (health/auth/whatsapp-webhook
  exempt), and blocks once per file. That block is your cue.

## When to run

- **Auto:** you received an `[api-endpoint] block=true` reason at Stop. Review the
  exact files + lines it lists.
- **Manual:** the user typed `/api-guard` or asked in natural language. Scan
  `git diff` for `src/modules/**/*.{controller,service}.ts`.

## Protocol

1. **Build the target set** (files/lines from the block reason, or `git diff`).

2. **For each file, apply the checklist:**
   - **i18n error keys.** Every `throw new *Exception(...)` / `throw new Error(...)`
     argument is a dotted key `'domain.errors.key'`, not prose. Reuse an existing key
     where one fits; add a new key (and its EN/ES translations on the consuming side)
     when needed. Confirm there's no space / sentence-case prose in the literal.
   - **Guards.** Each `@Get/@Post/@Patch/@Put/@Delete` that returns or mutates tenant
     data is under `@UseGuards(CondominiumAccessGuard)` (class- or method-level). If a
     route is intentionally public (health, auth, webhooks), keep it public **and add
     a one-line comment** stating why, so the absence is deliberate, not an oversight.
   - **DTO validation.** Request bodies/params use class-validator DTOs and are
     covered by the global `ValidationPipe` (or a controller-scoped pipe). Flag raw
     `any`/unvalidated bodies.

3. **Decide per file:** COMPLIANT or FIX (state which checks failed, with line refs).
   Apply fixes narrowly — swap prose for keys, add the missing guard/comment, wrap the
   body in a DTO. Do not change business logic.

4. **Verify — never claim green from memory.** This repo uses **Jest + npm**, NOT
   Vitest. Run the affected suites: `npm test -- <pattern>` (and `npm run build` /
   `npx tsc --noEmit` if types changed). Iterate until green.

5. **Report** — emit a summary table:

   | File | i18n errors | guard | DTO | Verdict |
   |---|---|---|---|---|
   | `modules/classification/classification.service.ts` | ❌ L1521 prose | n/a | ✅ | FIX |
   | `modules/notifications/notifications.controller.ts` | ✅ | ✅ | ✅ | COMPLIANT |

## Guardrails

- **Keys, not prose** — error bodies are i18n keys; the web owns the translations.
- **Fail closed on guards** — if unsure whether an endpoint exposes tenant data,
  require the guard.
- **Stay in scope** — convention fixes only; no business-logic or schema changes.
- **Jest, not Vitest** — running Vitest here produces false reds.
- **Opt-out:** the user can set `API_GUARD_OFF=1` (or `touch
  .claude/.cache/api-endpoint/OFF`) to skip the nudge this turn.
