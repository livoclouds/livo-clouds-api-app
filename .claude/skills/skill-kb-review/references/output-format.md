# Skills KB Review — output format

Concise, prioritized, actionable. No prose dumps. Lead with what's worth acting on.

```
## 🧠 Skills KB Review — <repo> · <date>

**Scope:** <all open | skill X | type Y>   ·   **Store:** `.claude/skill-kb/findings.jsonl`

### 🔁 Recurring / regressions (fix these first)
| id | skill | title | events | status |
|----|-------|-------|--------|--------|
| SK-… | … | … | 4× | 🔴 open (regresión) |

### 🔴 Open, by severity
| id | skill | type | sev | title | evidence |
|----|-------|------|-----|-------|----------|
| SK-… | … | limitation | high | … | path:line |

### 💡 Opportunities & improvements (backlog)
- **SK-…** · `skill` — <one-line idea>

### ✅ Resolved this review
- **SK-…** — <what> @ <where> (when)   ← only if you actually resolved something
```

Rules:
- If nothing is open: say **"No open findings — nothing to act on."** in one line and stop.
- Every actionable row gets a concrete next step, not just a restatement of the title.
- When you resolve/close an entry, show it in the "Resolved this review" block with the
  `what / where / when` you recorded — never close silently.
- Keep it scannable; this is a triage view, not a report. (For a full formal report, the
  user can run `findings-report-generator`.)
```
