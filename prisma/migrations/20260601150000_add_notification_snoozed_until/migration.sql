-- AlterTable
-- Idempotent guards mirror the recent migration style so a re-run (or a DB where
-- a prior attempt already added the column) does not fail.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "snoozedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_userId_snoozedUntil_idx" ON "notifications"("userId", "snoozedUntil");
