#!/usr/bin/env bash
# Stop hook for the api-endpoint-guardian skill (NestJS API repo).
#
# When the turn ends, check every controller/service Claude touched this session
# (recorded by track-endpoints.sh) with two cheap, high-signal heuristics:
#   1. Plain-English exception messages — a throw whose string literal contains a
#      space is prose, not an i18n key ('domain.errors.key' has no spaces). The web
#      localizes error KEYS, so prose leaks untranslated. Flag those lines.
#   2. A controller that declares routes (@Get/@Post/...) but has NO @UseGuards
#      anywhere — likely missing CondominiumAccessGuard. Known-public controllers
#      (health, auth, whatsapp-webhook) are exempt.
#
# Block once per file when either heuristic fires, so Claude runs the
# api-endpoint-guardian skill before finishing.
#
# Loop-breaker: each file is "nudged" at most once per session.
# Opt-out: API_GUARD_OFF=1  OR  a file <cache>/OFF exists.
#
# Failure-safe: every error path exits 0 (allow Stop). jq required.

set -u

input="$(cat 2>/dev/null || true)"

command -v jq >/dev/null 2>&1 || exit 0
[ "${API_GUARD_OFF:-0}" = "1" ] && exit 0

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null)"
[ -z "$session_id" ] && session_id="default"

cache_dir="${project_dir}/.claude/.cache/api-endpoint"
touched_file="${cache_dir}/${session_id}.touched"
nudged_file="${cache_dir}/${session_id}.nudged"

[ -f "${cache_dir}/OFF" ] && exit 0
[ -s "$touched_file" ] || exit 0

# Returns 0 (true) and prints findings if the file violates a convention.
findings_for() {
  local f="$1" out=""
  # Heuristic 1: plain-English throw (string literal with a space).
  local prose
  prose="$(grep -nE "throw new [A-Za-z]*(Exception|Error)\((['\"])[^'\"]* [^'\"]*\2" "$f" 2>/dev/null | head -3)"
  if [ -n "$prose" ]; then
    out="${out}      plain-English throw (use an i18n key 'domain.errors.key'):"$'\n'
    while IFS= read -r ln; do [ -n "$ln" ] && out="${out}        L${ln%%:*}"$'\n'; done <<EOF2
$prose
EOF2
  fi
  # Heuristic 2: controller declaring routes but no @UseGuards (skip public ones).
  case "$f" in
    *.controller.ts)
      case "$f" in
        *health.controller.ts|*auth.controller.ts|*whatsapp-webhook.controller.ts) : ;;
        *)
          if grep -qE '@(Get|Post|Patch|Put|Delete)\(' "$f" 2>/dev/null \
             && ! grep -qE '@UseGuards\(' "$f" 2>/dev/null; then
            out="${out}      no @UseGuards in a route controller (add CondominiumAccessGuard or document why public)"$'\n'
          fi
          ;;
      esac
      ;;
  esac
  [ -n "$out" ] && { printf '%s' "$out"; return 0; }
  return 1
}

block_body=""
fresh_any="false"
while IFS= read -r f || [ -n "$f" ]; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  found="$(findings_for "$f")" || continue
  rel="${f#"$project_dir"/}"
  # Only count as a fresh nudge if not nudged before.
  if [ -f "$nudged_file" ] && grep -qxF -- "$f" "$nudged_file" 2>/dev/null; then
    continue
  fi
  fresh_any="true"
  printf '%s\n' "$f" >> "$nudged_file" 2>/dev/null
  block_body="${block_body}  • ${rel}"$'\n'"${found}"
done < "$touched_file"

[ "$fresh_any" = "true" ] || exit 0

mkdir -p "$cache_dir" 2>/dev/null

reason="[api-endpoint] block=true — One or more NestJS controllers/services you touched this turn deviate from the API conventions. Before finishing, invoke the api-endpoint-guardian skill to review each: exceptions must throw an i18n KEY ('domain.errors.key'), never plain prose (the web localizes keys); every endpoint serving tenant data needs @UseGuards(CondominiumAccessGuard) (or a documented public reason); and DTOs must be validated (class-validator + the global ValidationPipe).

Findings:
${block_body}
See .claude/skills/api-endpoint-guardian/SKILL.md. To skip this turn, set API_GUARD_OFF=1."

jq -n --arg r "$reason" '{decision:"block", reason:$r}' 2>/dev/null || true
exit 0
