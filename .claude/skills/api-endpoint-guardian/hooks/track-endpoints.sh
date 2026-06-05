#!/usr/bin/env bash
# PostToolUse hook for the api-endpoint-guardian skill (NestJS API repo).
#
# Records every controller/service file Claude edits/creates so the Stop hook
# (check-endpoints.sh) can verify endpoint security + error-localization
# conventions.
#
# Scope: */src/modules/**/*.controller.ts  and  */src/modules/**/*.service.ts
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

case "$file_path" in
  *.spec.ts) exit 0 ;;
  */src/modules/*.controller.ts) : ;;
  */src/modules/*.service.ts) : ;;
  *) exit 0 ;;
esac

cache_dir="${project_dir}/.claude/.cache/api-endpoint"
touched_file="${cache_dir}/${session_id}.touched"
mkdir -p "$cache_dir" 2>/dev/null || exit 0

if [ -f "$touched_file" ] && grep -qxF -- "$file_path" "$touched_file" 2>/dev/null; then
  exit 0
fi
printf '%s\n' "$file_path" >> "$touched_file" 2>/dev/null || true

exit 0
