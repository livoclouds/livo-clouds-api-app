-- ENGINE-058 — persisted per-batch classification summary (precision baseline).
-- Additive only: defaults of 0 + nullable classifiedAt make backfill unnecessary;
-- "classifiedAt IS NULL" distinguishes pre-harness batches from "0 classified".
ALTER TABLE "import_batches"
  ADD COLUMN "classifiedCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "needsReviewCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unmatchedCount"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "classifiedAt"     TIMESTAMP(3);
