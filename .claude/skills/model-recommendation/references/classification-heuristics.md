# Classification Heuristics

Lightweight rules (regex + length + keyword count) used both by the bash hook (`hooks/classify-prompt.sh`) and by the manual skill flow when classifying a prompt.

## Decision Order

Evaluate top-to-bottom. First match wins.

### 1. Complex (→ Opus 4.7)

Prompt matches **any** of these patterns:

```regex
# Architecture / design keywords
(architect|design (the |a |an )?(system|service|module|flow|architecture))
(plan|planning) (complex|the entire|the full|the whole)
(decide between|choose between|evaluate options|tradeoff)
(reconciliation|migration strategy|multi[- ]?tenant|isolation analysis)
(audit|deep[- ]?dive|full review of)
(security review|threat model|vulnerability assessment)

# Multi-system signals
(across (the )?(repos|services|systems))
(cross[- ]?repo|cross[- ]?cutting)
```

Or **length-based**:
- Prompt length > 600 chars **and** mentions ≥3 distinct domains (auth, db, ui, api, etc.)

### 2. Trivial (→ Haiku 4.5)

Prompt matches **all** of:

- Length ≤ 60 characters
- Starts with a simple verb: `rm`, `ls`, `cat`, `mv`, `cp`, `show`, `list`, `cuál`, `qué`, `where`, `what is`, `where is`, `borra`, `elimina`, `muéstrame`, `enséñame`, `dame`
- Does **not** contain any complex keyword (see section 1)
- Does **not** contain implementation verbs (`implement`, `refactor`, `build`, `create`, `add`, `fix`, `update`, `change`, `modify`, `crea`, `agrega`, `arregla`, `cambia`)

Example matches:
- `rm -rf temp`
- `ls src/components`
- `qué es esto`
- `show me the auth file`

### 3. Standard (→ Sonnet 4.6)

Default for everything that didn't hit Complex or Trivial. Common patterns:

```regex
(implement|add|create|build|write) (a |the |an )?(component|hook|endpoint|function|util|test)
(refactor|rename|extract|move) (this|that|the)
(fix|resolve|debug|investigate) (the |a |an )?(bug|issue|error|test)
(update|modify|change|tweak) (the |a |an )?(behavior|logic|code)
```

## Edge Cases

- **Spanish/mixed**: same rules apply, treat Spanish verbs as equivalents (`implementa`, `arregla`, `diseña`, `audita`).
- **Code in prompt**: if the prompt contains a code block, default to Standard unless other signals push it elsewhere.
- **Question vs command**: questions ("how does X work?", "why is this slow?") default to Standard. Questions explicitly asking for design ("how should I architect X?") → Complex.
- **Multiple tasks in one prompt**: classify by the **most complex** task mentioned.
- **Empty / one-word prompts**: default to Trivial.

## Bash Hook Implementation Notes

The hook script (`hooks/classify-prompt.sh`) implements a **simplified** version of these rules (it's bash, not a parser). It checks:
1. Complex keywords (single grep)
2. Trivial: short length + trivial verb prefix
3. Default Standard

The manual skill flow can apply the full ruleset above for better precision when invoked explicitly.

---

_Last reviewed: 2026-05-17._
