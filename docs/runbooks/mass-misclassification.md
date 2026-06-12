# Runbook — Mass misclassification (engine linking the wrong residents/concepts)

**Symptom:** an import (or a rule change) produced many wrongly linked or
wrongly conceptualized transactions.

## Diagnosis

1. **Precision telemetry (ENGINE-058):**
   `GET condominiums/:slug/classification/precision?from=…&to=…` — override
   rates per `matchSource`, per rule, and per hardcoded pattern (`byPattern`,
   fed by the persisted `matchedPatternLabel`). A pattern or rule with a high
   override rate is your culprit.
2. **Single row forensics:**
   `GET condominiums/:slug/transactions/:id/audit-chain` — the chronological
   chain of who/what classified, overrode, approved or reopened the row.
3. **Rule inspection:** `GET condominiums/:slug/settings/reconciliation-rules`
   (editable Pass-0 rules) and `GET …/reconciliation-rules/system` (the
   engine's hardcoded catalog) to see what could have fired.

## Remediation paths (least → most invasive)

1. **Fix the rule, reapply to pending only:**
   edit/disable the offending rule, then
   `POST condominiums/:slug/settings/reconciliation-rules/apply-pending`.
   Scope: **only** `NEEDS_REVIEW` + reconciliation `PENDING` rows — it never
   touches AUTO links, manual overrides or reconciled rows. Response:
   `{ total, classified, needsReview, unmatched, skipped, appliedChanges }`.
2. **Re-run one batch:**
   `POST condominiums/:slug/imports/:batchId/classify`. Resets and reclassifies
   the batch's **engine-owned** rows. ⚠ This wipes engine-made links (and
   deletes their allocations atomically) before re-running — manual overrides
   and reconciled rows are preserved (`preservedManual`).
3. **Manual, row by row:** `PATCH …/transactions/:id/match | classify | unmatch`
   — these become `MANUAL_OVERRIDE` and are immune to later re-runs. Repeated
   identical corrections (2+) are learned (`CORRECTION_PATTERN`) and re-applied
   automatically on future imports.

## Notes

- Monthly summaries recompute automatically after every path above.
- A learned correction that itself is wrong: fix it once manually — the upsert
  overwrites the stored outcome for that exact description.
