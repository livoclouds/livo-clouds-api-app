-- Add a per-batch classification progress counter so the web can drive a real
-- per-transaction progress bar during the "classifying payments" phase.
ALTER TABLE "import_batches" ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0;
