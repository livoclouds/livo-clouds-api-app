# Runbook — Stuck import batch (PROCESSING that never finishes)

**Symptom:** an import batch stays `PROCESSING` (web shows the spinner forever,
or the background watcher reports "still running") and never reaches
`COMPLETED` / `FAILED`.

## How the engine decides a batch is stuck

- Classification runs asynchronously after `POST …/imports/confirm`
  (`runClassificationAsync`, fired via `setImmediate`).
- A `PROCESSING` batch is considered **live** while `updatedAt` is younger than
  `STALE_PROCESSING_MS` = **30 minutes** (`src/modules/imports/imports.constants.ts`).
  Progress writes (`processedCount`) refresh `updatedAt` every 200-row chunk,
  so a genuinely running classification never looks stale.
- Older than 30 minutes ⇒ the run crashed mid-classify (process restart, OOM).
  Transactions are persisted; only enrichment is missing.

## Diagnosis

1. `GET condominiums/:slug/imports/:id` — check `status`, `processedCount` vs
   `transactionCount`, `updatedAt`, `errorMessage`.
2. Sentry: search tag `batchId` (ENGINE-033 capture, stage `classify-async`).
3. Audit log: `IMPORT_FAILED` with `errorCode: CLASSIFICATION_FAILED` means the
   async step failed and already marked the batch `FAILED`.

## Recovery — re-run classification (safe, preserving)

```
POST condominiums/:slug/imports/:batchId/classify   (permission: transactions.override)
```

- **409 `IMPORT_BATCH_PROCESSING`** — the batch is still live (fresh
  `updatedAt`); wait and retry. The guard only admits stale/terminal batches.
- The re-run **preserves human work**: rows with `MANUAL_OVERRIDE` and rows
  already reconciled are excluded from the reset (`preservedManual` in the
  response tells you how many).
- Engine-owned rows are reset and reclassified; their payment allocations are
  deleted atomically with the reset (never orphaned).
- On success the batch lands `COMPLETED` with refreshed
  `classifiedCount/needsReviewCount/unmatchedCount`; on failure it lands
  `FAILED` with `errorMessage: "Reclassification failed: …"`.

## Last resort — delete the batch

```
DELETE condominiums/:slug/imports/:id
```

Side effects (ENGINE-002, all automatic): transactions are **hard-deleted**
(allocations cascade), terrace bookings marked PAID by this batch revert to
PENDING, monthly summaries for the affected months are recomputed, and the
batch row is kept as a `FAILED` audit anchor (the partial unique `fileHash`
index ignores `FAILED`, so re-uploading the same file works). The user can then
re-upload the export.

## Do NOT

- Do not flip `ImportBatch.status` by hand in SQL — counters, summaries and
  audit history will disagree with reality.
- Do not delete transactions by hand — terrace links and monthly summaries are
  only reverted by the endpoints above.
