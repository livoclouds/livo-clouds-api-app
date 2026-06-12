# Runbook — FAILED import recovery

**Symptom:** a batch shows `FAILED` in Import History. The web surfaces the
persisted `errorMessage` in the batch detail (Phase 6 web companion).

## What FAILED means here

Two distinct failure points write `FAILED`:

| `errorMessage` prefix | Failure point | Transactions persisted? |
| --- | --- | --- |
| `Classification failed: …` | async classify after a successful confirm (`runClassificationAsync`) | **Yes** — rows exist, only enrichment is missing |
| `Reclassification failed: …` | a re-run via `POST …/imports/:batchId/classify` | Yes (pre-existing) |

A confirm-time failure (parse/validation) returns an HTTP error instead and no
batch is left behind.

## Diagnosis

1. `GET condominiums/:slug/imports/:id` → `errorMessage`, counters.
2. Sentry: search tags `batchId` / `condominiumId` (ENGINE-033; stage
   `classify-async`). Background failures are captured there since Phase 6.
3. Audit log: `IMPORT_FAILED` (result WARNING) with
   `errorCode: CLASSIFICATION_FAILED` — the import itself succeeded, only
   enrichment failed.

## Recovery

1. **Re-run classification:**
   `POST condominiums/:slug/imports/:batchId/classify`
   - restores `COMPLETED` on success, refreshing
     `classifiedCount/needsReviewCount/unmatchedCount`;
   - preserves `MANUAL_OVERRIDE` + reconciled rows (`preservedManual`);
   - 409 `IMPORT_BATCH_PROCESSING` while a live run holds the batch
     (`updatedAt` fresher than 30 min — see
     [stuck-import-batch.md](stuck-import-batch.md)).
2. **If the file itself was bad:** `DELETE condominiums/:slug/imports/:id`
   (hard-deletes rows, reverts terrace links, recomputes summaries, keeps the
   batch as a FAILED audit anchor) and re-upload the corrected export.

## Summary drift

Monthly summaries recompute automatically on every classify/reclassify/delete
path. If a crash window still left `FinancialMonthlySummary` inconsistent,
rebuild all of them idempotently:

```
pnpm prisma:recompute-summaries
```

(Advisory-locked per tenant+month; safe to run while the API serves traffic.)
