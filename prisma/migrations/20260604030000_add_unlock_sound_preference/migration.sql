-- AlterEnum
-- Extend the shared sound catalog with five new presets. Additive only; the new
-- values are not referenced in this migration (the new columns default to the
-- pre-existing CHIME), so this is safe inside Prisma's migration transaction.
ALTER TYPE "NotificationSound" ADD VALUE 'AURORA';
ALTER TYPE "NotificationSound" ADD VALUE 'RIPPLE';
ALTER TYPE "NotificationSound" ADD VALUE 'CRYSTAL';
ALTER TYPE "NotificationSound" ADD VALUE 'EMBER';
ALTER TYPE "NotificationSound" ADD VALUE 'BEACON';

-- AlterTable
-- Account-level Lock Screen unlock-sound preference (mirrors the notification
-- sound flag/choice pair, but scoped per user rather than per condominium).
ALTER TABLE "user_ui_preferences"
  ADD COLUMN "unlockSoundEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "unlockSoundChoice" "NotificationSound" NOT NULL DEFAULT 'CHIME';
