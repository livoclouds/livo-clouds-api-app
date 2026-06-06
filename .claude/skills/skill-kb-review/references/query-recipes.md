# Skills KB — jq query recipes

Run these in Bash against the store so **only the filtered lines enter context** — never
cat the whole file. Set `F` first:

```bash
F="$(git rev-parse --show-toplevel 2>/dev/null)/.claude/skill-kb/findings.jsonl"
[ -f "$F" ] || F="$HOME/.claude/skill-kb/findings.jsonl"
[ -f "$F" ] || { echo "no Skills KB store yet"; }
```

The store is append-only, so the **current state** of a finding is the *last* line for
its `fp`. Every recipe below reduces to current state first.

## Current state of every finding (the base view)

```bash
jq -sc 'group_by(.fp) | map(.[-1])' "$F"
```

## Open findings, grouped by skill, highest severity first

```bash
jq -s '
  group_by(.fp) | map(.[-1])
  | map(select(.status=="open"))
  | sort_by({critical:0,high:1,medium:2,low:3}[.severity] // 9)
  | group_by(.skill)[]
  | {skill: .[0].skill, count: length,
     items: [.[] | {id, type, severity, title, evidence, regression, fp}]}
' "$F"
```

## Recurrence hot-spots (findings reported / reopened most often)

A high event-count for one `fp` = a problem that keeps coming back.

```bash
jq -s '
  group_by(.fp)
  | map({fp: .[0].fp, id: (.[-1].id), skill: (.[0].skill),
         title: (.[-1].title), status: (.[-1].status),
         events: length,
         reopened: ([.[] | select(.regression==true)] | length)})
  | map(select(.events > 1 or .reopened > 0))
  | sort_by(-.events)
' "$F"
```

## Active regressions (resolved, then came back open)

```bash
jq -sc 'group_by(.fp) | map(.[-1])
  | map(select(.status=="open" and .regression==true))
  | .[] | {id, skill, title, fp}' "$F"
```

## Counts by skill and status (quick triage table)

```bash
jq -s 'group_by(.fp) | map(.[-1])
  | group_by(.skill)[]
  | {skill: .[0].skill,
     open:     ([.[]|select(.status=="open")]|length),
     resolved: ([.[]|select(.status=="resolved")]|length),
     wontfix:  ([.[]|select(.status=="wontfix")]|length)}' "$F"
```

## Everything for one skill (when drilling in)

```bash
SKILL=test-sync-guardian
jq -sc --arg s "$SKILL" 'group_by(.fp) | map(.[-1]) | map(select(.skill==$s))
  | sort_by(.status, .id)[]' "$F"
```

## Opportunities & improvements only (the "what to build next" backlog)

```bash
jq -sc 'group_by(.fp) | map(.[-1])
  | map(select(.status=="open" and (.type=="opportunity" or .type=="improvement")))
  | sort_by(.skill)[] | {id, skill, type, title, fp}' "$F"
```
