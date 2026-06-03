-- AlterTable: persist per-user Do Not Disturb alongside the sound preference
ALTER TABLE "user_notification_sound_preferences" ADD COLUMN "dnd" BOOLEAN NOT NULL DEFAULT false;
