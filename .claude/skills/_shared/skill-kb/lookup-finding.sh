#!/usr/bin/env bash
# lookup-finding.sh — answer "is this finding already known / resolved?" cheaply.
#
# Reads the committed findings.jsonl locally (no network, ~0 tokens) and prints:
#   "<STATUS> <SK-ID>"   where STATUS ∈ OPEN | RESOLVED | WONTFIX
#   "UNKNOWN"            when the finding has never been recorded
#
# A skill consults this BEFORE re-fixing something so it never re-corrects an
# issue that is already resolved (and can detect a regression: a RESOLVED fp that
# is happening again).
#
# Usage:
#   lookup-finding.sh <fingerprint>
#   lookup-finding.sh --skill <name> --type <type> --title "<title>"   # computes fp
#
# Exit code is always 0 (failure-safe); rely on the printed STATUS.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
. "$HERE/fingerprint.sh"   2>/dev/null || { echo "UNKNOWN"; exit 0; }
. "$HERE/resolve-store.sh" 2>/dev/null || { echo "UNKNOWN"; exit 0; }

command -v jq >/dev/null 2>&1 || { echo "UNKNOWN"; exit 0; }

fp="" skill="" type="" title=""
case "${1:-}" in
  --*) : ;;                      # flag form, parse below
  "")  echo "UNKNOWN"; exit 0 ;;
  *)   fp="$1" ;;                 # bare fingerprint
esac
if [ -z "$fp" ]; then
  while [ $# -gt 0 ]; do
    case "$1" in
      --skill) skill="${2:-}"; shift 2 ;;
      --type)  type="${2:-}";  shift 2 ;;
      --title) title="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done
  [ -n "$skill" ] && [ -n "$type" ] && [ -n "$title" ] || { echo "UNKNOWN"; exit 0; }
  fp="$(skkb_fingerprint "$skill" "$type" "$title")"
fi
[ -n "$fp" ] || { echo "UNKNOWN"; exit 0; }

findings="$(skkb_store_dir)/findings.jsonl"
[ -f "$findings" ] || { echo "UNKNOWN"; exit 0; }

cur="$(jq -c --arg fp "$fp" 'select(.fp==$fp)' "$findings" 2>/dev/null | tail -1)"
[ -n "$cur" ] || { echo "UNKNOWN"; exit 0; }

status="$(printf '%s' "$cur" | jq -r '.status' 2>/dev/null | tr '[:lower:]' '[:upper:]')"
id="$(printf '%s' "$cur" | jq -r '.id' 2>/dev/null)"
printf '%s %s\n' "${status:-UNKNOWN}" "$id"
exit 0
