#!/usr/bin/env bash
# PostToolUse hook for the clean-architecture-guardian skill (livo-clouds-api, NestJS).
#
# Records every source file Claude edits/creates so the Stop hook
# (check-architecture.sh) can apply the HARD architecture/clean-code heuristics.
#
# Scope: */src/**/*.ts
#   excluded: *.spec.ts · *.e2e-spec.ts · *.d.ts (tests/decls carry no architecture)
#
# Reads the hook input JSON from stdin:
#   {"session_id":"...","tool_input":{"file_path":"..."}, ...}
#
# Cost: ~0 LLM tokens (pure bash) · runtime a few ms.
# Failure-safe: every error path exits 0 (never blocks a tool call).

set -u

input="$(cat 2>/dev/null || true)"

command -v jq >/dev/null 2>&1 || exit 0

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"

session_id="$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null)"
[ -z "$session_id" ] && session_id="default"

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
[ -z "$file_path" ] && exit 0

# Skip tests and type declarations.
case "$file_path" in
  *.spec.ts|*.e2e-spec.ts|*.d.ts) exit 0 ;;
esac

# Only source files under src/ are in scope.
case "$file_path" in
  */src/*.ts) : ;;
  *) exit 0 ;;
esac

cache_dir="${project_dir}/.claude/.cache/clean-architecture"
touched_file="${cache_dir}/${session_id}.touched"
mkdir -p "$cache_dir" 2>/dev/null || exit 0

if [ -f "$touched_file" ] && grep -qxF -- "$file_path" "$touched_file" 2>/dev/null; then
  exit 0
fi
printf '%s\n' "$file_path" >> "$touched_file" 2>/dev/null || true

exit 0
