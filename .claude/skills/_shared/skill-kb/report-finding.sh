#!/usr/bin/env bash
# report-finding.sh — record (or resolve) a valuable skill finding into the
# committed, local Skills-KB store. Append-only, ~0 tokens, never blocks.
#
# Modeled on the guardian track hooks (api-endpoint-guardian/track-endpoints.sh):
#   `set -u` (no `-e`), every error path exits 0, so a skill that calls this can
#   never be disrupted by a logging failure.
#
# READ THE GATE FIRST (_shared/skill-kb/CONTRACT.md): only call this for findings
# that are worth keeping. Normal/successful runs MUST NOT be logged.
#
# Usage — record a finding:
#   report-finding.sh --skill <name> --type <type> --title "<canonical title>" \
#       [--severity low|medium|high|critical] [--evidence "path:line"] [--note "..."]
#   types: issue | unrecoverable-failure | limitation | opportunity | improvement
#
# Usage — resolve / wontfix an existing finding (by fingerprint):
#   report-finding.sh --resolve <fp> --what "<what was fixed>" --where "<file|PR>"
#   report-finding.sh --wontfix <fp> --what "<why not fixing>"
#
# The `when` of a resolution and all timestamps are stamped by `date`, never by
# the caller. The stable id (SK-<skill>-NNN) is assigned here under the lock.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=fingerprint.sh
. "$HERE/fingerprint.sh" 2>/dev/null || exit 0
# shellcheck source=resolve-store.sh
. "$HERE/resolve-store.sh" 2>/dev/null || exit 0
# shellcheck source=lock.sh
. "$HERE/lock.sh" 2>/dev/null || exit 0

# jq is required to build/parse JSON safely. No jq -> do nothing (failure-safe).
command -v jq >/dev/null 2>&1 || exit 0

mode="append"
skill="" type="" title="" severity="medium" evidence="" note=""
fp="" what="" where=""

while [ $# -gt 0 ]; do
  case "$1" in
    --resolve)  mode="resolve"; fp="${2:-}";       shift 2 ;;
    --wontfix)  mode="wontfix"; fp="${2:-}";       shift 2 ;;
    --skill)    skill="${2:-}";                    shift 2 ;;
    --type)     type="${2:-}";                     shift 2 ;;
    --title)    title="${2:-}";                    shift 2 ;;
    --severity) severity="${2:-}";                 shift 2 ;;
    --evidence) evidence="${2:-}";                 shift 2 ;;
    --note)     note="${2:-}";                     shift 2 ;;
    --what)     what="${2:-}";                      shift 2 ;;
    --where)    where="${2:-}";                     shift 2 ;;
    *)          shift ;;
  esac
done

store_dir="$(skkb_store_dir)"
repo="$(skkb_repo_name)"
mkdir -p "$store_dir" 2>/dev/null || exit 0
findings="$store_dir/findings.jsonl"
[ -f "$findings" ] || : > "$findings"

session_id="${CLAUDE_SESSION_ID:-${CLAUDE_JOB_DIR##*/}}"
[ -z "$session_id" ] && session_id="manual"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
today="$(date +%Y-%m-%d)"

valid_type() {
  case "$1" in
    issue|unrecoverable-failure|limitation|opportunity|improvement) return 0 ;;
    *) return 1 ;;
  esac
}

# Current (latest) record for a fingerprint = the last line carrying that fp.
current_for_fp() {
  jq -c --arg fp "$1" 'select(.fp==$fp)' "$findings" 2>/dev/null | tail -1
}

# Next sequential NNN for a skill (max trailing number across its records + 1).
next_id() {
  local s="$1" max
  max="$(jq -r --arg s "$s" 'select(.skill==$s) | .id' "$findings" 2>/dev/null \
        | sed -E 's/.*-([0-9]+)$/\1/' | sort -n | tail -1)"
  printf 'SK-%s-%03d' "$s" "$(( ${max:-0} + 1 ))"
}

# ── Rebuild SKILL-KB.md (human view) from the current state of findings.jsonl ──
# Current state per finding = the LAST line for each fp (append-only history).
render_md() {
  local md="$store_dir/SKILL-KB.md"
  local cur; cur="$(jq -sc 'group_by(.fp) | map(.[-1])' "$findings" 2>/dev/null)"
  [ -z "$cur" ] && cur="[]"
  {
    printf '# 🧠 Skills Knowledge Base — %s\n\n' "$repo"
    printf '> Auto-generado por `report-finding.sh`. Fuente de verdad: `findings.jsonl`. **No editar a mano.**\n'
    printf '> Última actualización: %s\n\n' "$today"

    printf '## Resumen\n\n'
    printf '| Skill | 🔴 open | ✅ resolved | ⚪ wontfix |\n|---|---|---|---|\n'
    printf '%s' "$cur" | jq -r '
      group_by(.skill)[] |
      [ (.[0].skill),
        ([.[]|select(.status=="open")]|length),
        ([.[]|select(.status=="resolved")]|length),
        ([.[]|select(.status=="wontfix")]|length)
      ] | "| \(.[0]) | \(.[1]) | \(.[2]) | \(.[3]) |"'
    printf '\n'

    printf '## 🔴 Abiertos\n\n'
    local open_rows
    open_rows="$(printf '%s' "$cur" | jq -r '
      [.[]|select(.status=="open")] | sort_by(.skill, .id)[] |
      "- **\(.id)** · `\(.skill)` · \(.type) · \(.severity)\(if .regression then " · ⚠️ regresión" else "" end)\n  - \(.title)\(if (.evidence//"")!="" then "\n  - 📍 \(.evidence)" else "" end)\(if (.note//"")!="" then "\n  - 📝 \(.note)" else "" end)\n  - `fp:\(.fp)`"')"
    [ -n "$open_rows" ] && printf '%s\n\n' "$open_rows" || printf '_(ninguno)_\n\n'

    printf '## ✅ Resueltos\n\n'
    local res_rows
    res_rows="$(printf '%s' "$cur" | jq -r '
      [.[]|select(.status=="resolved")] | sort_by(.skill, .id)[] |
      "- **\(.id)** · `\(.skill)` · \(.title) — ✅ \(.resolution.when // "?"): \(.resolution.what // "") (\(.resolution.where // ""))"')"
    [ -n "$res_rows" ] && printf '%s\n\n' "$res_rows" || printf '_(ninguno)_\n\n'

    local wf_rows
    wf_rows="$(printf '%s' "$cur" | jq -r '[.[]|select(.status=="wontfix")] | sort_by(.skill,.id)[] | "- **\(.id)** · `\(.skill)` · \(.title) — ⚪ \(.resolution.what // "")"')"
    if [ -n "$wf_rows" ]; then printf '## ⚪ Wontfix\n\n%s\n' "$wf_rows"; fi
  } > "$md" 2>/dev/null || true
}

# ─────────────────────────────── do the work ────────────────────────────────
skkb_acquire_lock || exit 0
trap 'skkb_release_lock' EXIT

case "$mode" in
  append)
    [ -n "$skill" ] && [ -n "$type" ] && [ -n "$title" ] || exit 0
    valid_type "$type" || exit 0
    fp="$(skkb_fingerprint "$skill" "$type" "$title")"
    [ -n "$fp" ] || exit 0

    cur="$(current_for_fp "$fp")"
    regression=false
    if [ -n "$cur" ]; then
      cur_status="$(printf '%s' "$cur" | jq -r '.status' 2>/dev/null)"
      id="$(printf '%s' "$cur" | jq -r '.id' 2>/dev/null)"
      case "$cur_status" in
        open)              exit 0 ;;           # already open this is idempotent — no dup
        resolved|wontfix)  regression=true ;;  # reappeared -> reopen same id
      esac
    else
      id="$(next_id "$skill")"
    fi

    jq -nc \
      --arg id "$id" --arg fp "$fp" --arg skill "$skill" --arg type "$type" \
      --arg title "$title" --arg severity "$severity" --arg repo "$repo" \
      --arg evidence "$evidence" --arg note "$note" --arg session "$session_id" \
      --arg ts "$ts" --argjson regression "$regression" \
      '{id:$id,fp:$fp,skill:$skill,type:$type,title:$title,severity:$severity,
        status:"open",repo:$repo,evidence:$evidence,note:$note,
        session_id:$session,ts:$ts,regression:$regression,resolution:null}' \
      >> "$findings" 2>/dev/null || exit 0
    ;;

  resolve|wontfix)
    [ -n "$fp" ] || exit 0
    cur="$(current_for_fp "$fp")"
    [ -n "$cur" ] || exit 0   # nothing to resolve
    new_status="resolved"; [ "$mode" = "wontfix" ] && new_status="wontfix"
    printf '%s' "$cur" | jq -c \
      --arg ts "$ts" --arg status "$new_status" \
      --arg what "$what" --arg where "$where" --arg when "$today" \
      '.status=$status | .ts=$ts | .regression=false |
       .resolution={what:$what,where:$where,when:$when}' \
      >> "$findings" 2>/dev/null || exit 0
    ;;
esac

render_md
exit 0
