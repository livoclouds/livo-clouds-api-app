#!/usr/bin/env bash
# UserPromptSubmit hook — proactive architecture/clean-code nudge for the
# clean-architecture-guardian skill (livo-clouds-api, NestJS).
#
# Reads the hook input JSON from stdin ({"prompt": "...", ...}). When the user is
# asking to implement / change code (a module, controller, service, endpoint, DTO,
# function, refactor, …), inject a one-line reminder of the API architecture +
# clean-code rules so they apply BEFORE the code is written — not just caught after
# by the Stop hook.
#
# Two-signal: an action verb AND a code-surface referent must both be present, so a
# plain question never triggers.
#
# Cost: ~0 LLM tokens (pure bash) · runtime ~5-15 ms.
# Failure-safe: any error path exits 0 with empty context (never blocks a prompt).
# Opt-out: CLEAN_ARCH_OFF=1.

set -u

input="$(cat 2>/dev/null || true)"

command -v jq >/dev/null 2>&1 || exit 0
[ "${CLEAN_ARCH_OFF:-0}" = "1" ] && exit 0

prompt="$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)"
[ -z "$prompt" ] && exit 0

prompt_lc="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"

# --- Action verb (build / change code) ------------------------------------
action_re='\b(build|create|crea|crear|add|añad|anad|agrega|agregar|implement|implementa|implementar|write|escribe|escribir|make|haz|hacer|update|actualiza|refactor|refactoriza|refactorizar|fix|arregla|arreglar|extract|extrae|wire|integra|integrar|expose|expón|expon)\b'

# --- Code-surface referent (EN + ES) --------------------------------------
surface_re='\b(module|módulo|modulo|controller|controlador|service|servicio|endpoint|route|ruta|api|dto|guard|interceptor|pipe|filter|repository|repositorio|provider|proveedor|function|función|funcion|method|método|metodo|class|clase|prisma|query|consulta|migration|migración|migracion|logic|lógica|logica|feature|funcionalidad|architecture|arquitectura|layer|capa|refactor|event|evento|type|tipo|entity|entidad)\b'

if printf '%s' "$prompt_lc" | grep -qE "$action_re" \
   && printf '%s' "$prompt_lc" | grep -qE "$surface_re"; then
  context="[clean-architecture] mode=api · This looks like implementation/refactor work. Follow the LivoClouds API (NestJS) architecture BEFORE writing code: (1) layering — controllers validate (DTO) and DELEGATE; services own business logic AND Prisma access; never reference PrismaService from a controller, never leak HTTP concerns into a service. (2) Module encapsulation — a module owns/exports its own providers; need another module's provider, import that module; cross-service side effects go through EventEmitter2 (ADR-010), not direct cross-module service calls. (3) Boundary validation — every @Body()/@Query() uses a class-validator DTO (global ValidationPipe: whitelist + transform). (4) Clean code — small focused methods/services (no god service), clear names, named constants over magic numbers, NO \`any\`, no dead code; filter soft-deletes (deletedAt: null), never expose passwordHash, keep queries bounded (select/include + pagination). The Stop hook check-architecture.sh will hard-block on a controller touching Prisma, a new \`any\`, or god-files. Endpoint security + i18n error keys are owned by api-endpoint-guardian. See .claude/skills/clean-architecture-guardian/SKILL.md. Opt-out: CLEAN_ARCH_OFF=1."

  jq -n --arg ctx "$context" '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: $ctx
    }
  }' 2>/dev/null || true
fi

exit 0
