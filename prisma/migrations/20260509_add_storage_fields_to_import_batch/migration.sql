-- Add optional external storage fields to import_batches.
-- storageKey: object key in the external storage provider (e.g. Cloudflare R2).
-- storageProvider: identifier for the provider used ("r2" | "s3").
-- NULL in both fields means the original file was not retained (current default behavior).

ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "storageProvider" TEXT;
