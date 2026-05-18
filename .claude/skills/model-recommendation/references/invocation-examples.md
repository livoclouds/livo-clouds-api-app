# Invocation Examples

Ten real-world prompts and the recommendation the skill should produce. Use as calibration when uncertain.

---

### 1. "borra el folder tmp"

```
Task: trivial
Recommend: Haiku 4.5
Why: 17 chars, simple delete verb, no design or implementation cues.
```

---

### 2. "ls -la src/components"

```
Task: trivial
Recommend: Haiku 4.5
Why: file-listing command, <30 chars, no judgment required.
```

---

### 3. "implementa el endpoint POST /payments con validación Zod y conexión a Stripe"

```
Task: standard
Recommend: Sonnet 4.6
Why: scoped implementation with clear contract; no architecture decisions surfaced.
```

---

### 4. "refactor el TransactionsTable para usar TanStack Table"

```
Task: standard
Recommend: Sonnet 4.6
Why: mechanical refactor with a known target library; single-component scope.
```

---

### 5. "fix the bug where the modal doesn't close on Esc"

```
Task: standard
Recommend: Sonnet 4.6
Why: well-scoped bug, single component, no design decisions.
```

---

### 6. "diseña el sistema de reconciliación bancaria multi-tenant que reconcile transactions across the API and web app"

```
Task: complex
Recommend: Opus 4.7
Why: keyword "diseña … reconciliación … multi-tenant", cross-repo, architectural.
```

---

### 7. "audit the entire authentication flow across web-app and api-app"

```
Task: complex
Recommend: Opus 4.7
Why: keyword "audit … entire … across", multi-repo, judgment-heavy review.
```

---

### 8. "decide between Redis and Postgres advisory locks for the import concurrency limiter"

```
Task: complex
Recommend: Opus 4.7
Why: keyword "decide between", architectural tradeoff with downstream implications.
```

---

### 9. "agrega un console.log para debuggear esta función"

```
Task: trivial
Recommend: Haiku 4.5
Why: 47 chars, single-line addition, debugging breadcrumb only.
```

---

### 10. "explica cómo funciona el pipeline de imports en este repo"

```
Task: standard
Recommend: Sonnet 4.6
Why: requires reading multiple files and synthesizing, but no design judgment.
```

---

## Borderline / Tricky

### "agrega validación a este formulario"

Depends on size of the form and existing validation infrastructure. Default to **Standard / Sonnet 4.6**. Upgrade to Opus only if "agrega validación" expands to "design the validation strategy across N forms".

### "arregla el bug del calendario"

If the user knows where the bug is → **Standard / Sonnet**. If unclear root cause → **Complex / Opus**. Ask one clarifying question before classifying when ambiguity is high.

---

_Last reviewed: 2026-05-17._
