-- Inactivity screen lock (server-authoritative).
-- Additive, non-destructive: new nullable columns + columns with defaults.

-- AlterTable: per-user inactivity timeout (minutes) before the in-app lock engages.
ALTER TABLE "users" ADD COLUMN "inactivityLockMinutes" INTEGER NOT NULL DEFAULT 15;

-- AlterTable: per-session lock bookkeeping.
ALTER TABLE "refresh_tokens" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
ALTER TABLE "refresh_tokens" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "refresh_tokens" ADD COLUMN "failedUnlockAttempts" INTEGER NOT NULL DEFAULT 0;
