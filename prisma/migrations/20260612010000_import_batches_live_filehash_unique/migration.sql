-- ENGINE-017 — at most one live (non-FAILED) batch per (condominiumId, fileHash).
-- The previous dedup was application-level check-then-insert (TOCTOU): two
-- genuinely concurrent uploads of the same file could both create confirmable
-- batches, double-counting every row downstream.
--
-- Pre-clean: demote (never delete — they may own transactions) all but the
-- best batch per duplicate live group. Keep rule: most transactions first,
-- then most recent.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "condominiumId", "fileHash"
    ORDER BY "transactionCount" DESC, "createdAt" DESC
  ) AS rn
  FROM "import_batches"
  WHERE status <> 'FAILED'
)
UPDATE "import_batches"
SET status = 'FAILED',
    "errorMessage" = 'Superseded duplicate (ENGINE-017 unique-index migration)'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Partial unique index — Prisma cannot model partial indexes, so this lives
-- only in SQL. FAILED batches are excluded on purpose: they are the terminal
-- state used by user-delete and the stuck-batch reaper, and re-upload after
-- either must stay possible.
CREATE UNIQUE INDEX "import_batches_condominiumId_fileHash_live_key"
ON "import_batches" ("condominiumId", "fileHash")
WHERE status <> 'FAILED';
