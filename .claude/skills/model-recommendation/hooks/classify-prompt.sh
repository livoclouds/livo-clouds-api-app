#!/usr/bin/env bash
# UserPromptSubmit hook for the model-recommendation skill.
#
# Reads the hook input JSON from stdin ({"prompt": "...", ...}),
# classifies the prompt with cheap bash heuristics, and emits a JSON
# response with `hookSpecificOutput.additionalContext` so Claude Code's
# main loop can decide whether to surface a one-line suggestion to the user.
#
# Cost: ~0 LLM tokens (pure bash) · runtime ~5-15 ms.
#
# Failure-safe: any error path exits 0 with an empty context (never blocks the prompt).

set -u
# Do not 'set -e' — we want to swallow failures and never block prompts.

input="$(cat 2>/dev/null || true)"

# Extract the prompt field. If jq is unavailable or input is malformed, exit silently.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi
prompt="$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)"
if [ -z "$prompt" ]; then
  exit 0
fi

chars=${#prompt}
prompt_lc="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"

# --- Classification (decision order: complex → trivial → standard) ---

klass="standard"
sugg="Sonnet 4.6"

# 1) Complex signals
complex_re='architect|design[[:space:]]+(the[[:space:]]+|a[[:space:]]+|an[[:space:]]+)?(system|service|module|flow|architecture)|decide[[:space:]]+between|choose[[:space:]]+between|reconciliation|migration[[:space:]]+strategy|multi[-[:space:]]?tenant|isolation[[:space:]]+analysis|audit|deep[-[:space:]]?dive|full[[:space:]]+review[[:space:]]+of|security[[:space:]]+review|threat[[:space:]]+model|vulnerability[[:space:]]+assessment|cross[-[:space:]]?repo|cross[-[:space:]]?cutting|diseña|audita'

if printf '%s' "$prompt_lc" | grep -qE "$complex_re"; then
  klass="complex"
  sugg="Opus 4.7"
else
  # 2) Trivial signals — short + simple verb prefix + no impl/design keyword
  if [ "$chars" -le 60 ]; then
    trivial_prefix_re='^[[:space:]]*(rm|ls|cat|mv|cp|show|list|find|which|where|what|cuál|cual|qué|que|borra|elimina|muéstrame|muestrame|enséñame|ensename|dame)\b'
    impl_re='implement|refactor|build|create|add|fix|update|change|modify|crea|agrega|arregla|cambia|design|architect'
    if printf '%s' "$prompt_lc" | grep -qE "$trivial_prefix_re" && ! printf '%s' "$prompt_lc" | grep -qE "$impl_re"; then
      klass="trivial"
      sugg="Haiku 4.5"
    fi
  fi
fi

# --- Emit JSON with additionalContext ---
# Keep the context line short and tagged. Claude Code's main loop reads this
# and decides whether to mention it to the user in ONE line (per SKILL.md rules).

context="[model-fit] task=${klass} · suggested=${sugg} · chars=${chars} · If active model substantially differs from the suggestion AND the user is starting a new request (not mid-flow), mention it in ONE line. Otherwise stay silent."

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}' 2>/dev/null || true

exit 0
