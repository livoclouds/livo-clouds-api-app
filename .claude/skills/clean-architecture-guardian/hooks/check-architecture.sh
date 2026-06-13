#!/usr/bin/env bash
# Stop hook for the clean-architecture-guardian skill (livo-clouds-api, NestJS).
#
# HYBRID enforcement — when the turn ends, scan every source file Claude touched
# this session (recorded by track-architecture.sh) and hard-BLOCK only on the small,
# unambiguous HARD set. Everything subtler is left to the skill's judgment review.
#
# HARD set (per file):
#   1. Layering leak — a *.controller.ts referencing PrismaService / this.prisma
#      directly (controllers validate + delegate; data access lives in services).
#   2. New `any` — a `: any` / `as any` added this turn (tracked files: added diff
#      lines; new files: anywhere in the file).
#   3. God file — a touched file over the line threshold.
#
# Loop-breaker: each file is "nudged" at most once per session.
# Opt-out: CLEAN_ARCH_OFF=1  OR  a file <cache>/OFF exists.
#
# Failure-safe: every error path exits 0 (allow Stop). jq required.

set -u

input="$(cat 2>/dev/null || true)"

command -v jq >/dev/null 2>&1 || exit 0
[ "${CLEAN_ARCH_OFF:-0}" = "1" ] && exit 0

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null)"
[ -z "$session_id" ] && session_id="default"

cache_dir="${project_dir}/.claude/.cache/clean-architecture"
touched_file="${cache_dir}/${session_id}.touched"
nudged_file="${cache_dir}/${session_id}.nudged"

[ -f "${cache_dir}/OFF" ] && exit 0
[ -s "$touched_file" ] || exit 0

GOD_FILE_LINES="${CLEAN_ARCH_GOD_FILE_LINES:-500}"

# Is a path NEW to git (untracked)? `ls-files --error-unmatch` fails for new files.
is_new_to_git() {
  git -C "$project_dir" ls-files --error-unmatch -- "$1" >/dev/null 2>&1 && return 1 || return 0
}

# Returns 0 (true) and prints findings if the file trips a HARD heuristic.
findings_for() {
  local f="$1" out=""

  # 1. Layering leak — a controller touching Prisma directly.
  case "$f" in
    *.controller.ts)
      local leak
      leak="$(grep -nE 'PrismaService|this\.prisma\b|\bprisma\.[a-zA-Z]' "$f" 2>/dev/null | head -3)"
      if [ -n "$leak" ]; then
        out="${out}      layering leak — controller references Prisma directly (delegate to a service):"$'\n'
        while IFS= read -r ln; do [ -n "$ln" ] && out="${out}        L${ln%%:*}"$'\n'; done <<EOF2
$leak
EOF2
      fi
      ;;
  esac

  # 2. New `any` — added lines (tracked) or anywhere (new file).
  local anyhits=""
  if is_new_to_git "$f"; then
    anyhits="$(grep -nE ':[[:space:]]*any\b|\bas[[:space:]]+any\b|\bany\[\]' "$f" 2>/dev/null | head -3)"
  else
    anyhits="$(git -C "$project_dir" diff -- "$f" 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+' \
      | grep -nE ':[[:space:]]*any\b|\bas[[:space:]]+any\b|\bany\[\]' | head -3)"
  fi
  if [ -n "$anyhits" ]; then
    out="${out}      new \`any\` introduced (use a real type / unknown + narrowing):"$'\n'
    while IFS= read -r ln; do [ -n "$ln" ] && out="${out}        ${ln}"$'\n'; done <<EOF3
$anyhits
EOF3
  fi

  # 3. God file.
  local lc
  lc="$(wc -l < "$f" 2>/dev/null | tr -d ' ')"
  if [ -n "$lc" ] && [ "$lc" -gt "$GOD_FILE_LINES" ] 2>/dev/null; then
    out="${out}      god file — ${lc} lines (> ${GOD_FILE_LINES}); split by responsibility"$'\n'
  fi

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
  if [ -f "$nudged_file" ] && grep -qxF -- "$f" "$nudged_file" 2>/dev/null; then
    continue
  fi
  fresh_any="true"
  mkdir -p "$cache_dir" 2>/dev/null
  printf '%s\n' "$f" >> "$nudged_file" 2>/dev/null
  block_body="${block_body}  • ${rel}"$'\n'"${found}"
done < "$touched_file"

[ "$fresh_any" = "true" ] || exit 0

reason="[clean-architecture] block=true — One or more files you touched this turn tripped a HARD architecture/clean-code rule. Before finishing, invoke the clean-architecture-guardian skill to fix these and review the full checklist: controllers validate + delegate (no Prisma, no business logic); services own the rules + data access; modules stay encapsulated and cross-service effects go through EventEmitter2 (ADR-010); no \`any\`; small focused units with clear names and named constants over magic numbers. Endpoint security + i18n error keys remain owned by api-endpoint-guardian.

Findings:
${block_body}
See .claude/skills/clean-architecture-guardian/SKILL.md. To skip this turn, set CLEAN_ARCH_OFF=1."

jq -n --arg r "$reason" '{decision:"block", reason:$r}' 2>/dev/null || true
exit 0
