-- AlterTable
-- Account-level Lock Screen LOCK-sound preference (mirrors the unlock-sound
-- flag/choice pair, played when the screen engages rather than on a successful
-- unlock). Additive with safe defaults so existing rows need no backfill.
ALTER TABLE "user_ui_preferences"
  ADD COLUMN "lockSoundEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lockSoundChoice" "NotificationSound" NOT NULL DEFAULT 'CHIME';
