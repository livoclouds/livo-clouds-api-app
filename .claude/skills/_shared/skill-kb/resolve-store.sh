#!/usr/bin/env bash
# resolve-store.sh — locate the committed Skills-KB store for the current context.
#
# Sourced by report-finding.sh / lookup-finding.sh. Provides:
#   skkb_store_dir   -> "<repo-root>/.claude/skill-kb"  (or "$HOME/.claude/skill-kb")
#   skkb_repo_name   -> basename of the repo root        (or "global")
#
# A skill runs in the context of a repo (CLAUDE_PROJECT_DIR or cwd). The store
# lives committed inside that repo at .claude/skill-kb/ (NOT gitignored), so the
# finding ships in the normal commit the agent already makes — no extra PR, no
# network, ~0 tokens. Global skills with no repo fall back to ~/.claude/skill-kb/.

_skkb_repo_root() {
  git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --show-toplevel 2>/dev/null || true
}

skkb_store_dir() {
  local root; root="$(_skkb_repo_root)"
  if [ -n "$root" ]; then
    printf '%s/.claude/skill-kb' "$root"
  else
    printf '%s/.claude/skill-kb' "$HOME"
  fi
}

skkb_repo_name() {
  local root; root="$(_skkb_repo_root)"
  if [ -n "$root" ]; then
    printf '%s' "${root##*/}"
  else
    printf 'global'
  fi
}
