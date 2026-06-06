#!/usr/bin/env bash
# lock.sh — cross-agent write lock for the Skills-KB store.
#
# Sourced by report-finding.sh. Provides:
#   skkb_acquire_lock   -> 0 on success, 1 if it gives up (caller should exit 0)
#   skkb_release_lock   -> always 0
#
# Mirrors the canonical lock in
#   git-housekeeping/references/concurrency-lock.md
# `mkdir` is atomic on POSIX (no TOCTOU window) — never substitute `touch`/`>`.
# The lock is keyed off the shared git dir so all worktrees of the same repo
# contend for the same lock; global (no repo) uses ~/.claude/.cache.
#
# Tunables (env, with safe defaults):
#   SKKB_LOCK_TIMEOUT  stale-lock reclaim threshold (s, default 60)
#   SKKB_MAX_WAIT      give up acquiring after (s, default 15)

SKKB_LOCK_HELD=""

_skkb_lock_dir() {
  local gitc
  gitc="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -n "$gitc" ]; then
    printf '%s/.skill-kb.lock' "$gitc"
  else
    mkdir -p "$HOME/.claude/.cache" 2>/dev/null || true
    printf '%s/.claude/.cache/.skill-kb.lock' "$HOME"
  fi
}

skkb_acquire_lock() {
  local lock_dir timeout max_wait waited=0
  lock_dir="$(_skkb_lock_dir)"
  timeout="${SKKB_LOCK_TIMEOUT:-60}"
  max_wait="${SKKB_MAX_WAIT:-15}"

  while :; do
    if mkdir "$lock_dir" 2>/dev/null; then
      printf 'pid=%s\nepoch=%s\n' "$$" "$(date +%s)" > "$lock_dir/owner" 2>/dev/null || true
      SKKB_LOCK_HELD="$lock_dir"
      return 0
    fi
    # Lock exists — reclaim if stale.
    local owner_epoch now age
    owner_epoch="$(sed -n 's/^epoch=//p' "$lock_dir/owner" 2>/dev/null)"
    now="$(date +%s)"
    if [ -n "$owner_epoch" ]; then
      age=$(( now - owner_epoch ))
      if [ "$age" -ge "$timeout" ]; then
        rm -rf "$lock_dir" 2>/dev/null || true
        continue
      fi
    fi
    if [ "$waited" -ge "$max_wait" ]; then
      return 1
    fi
    sleep 1; waited=$(( waited + 1 ))
  done
}

skkb_release_lock() {
  [ -n "$SKKB_LOCK_HELD" ] && rm -rf "$SKKB_LOCK_HELD" 2>/dev/null || true
  SKKB_LOCK_HELD=""
  return 0
}
