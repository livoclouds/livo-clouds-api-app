-- CreateEnum
CREATE TYPE "NotificationSound" AS ENUM ('CHIME', 'DING', 'POP', 'SHIMMER', 'PEBBLE');

-- CreateTable
CREATE TABLE "user_notification_sound_preferences" (
    "userId" TEXT NOT NULL,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "soundChoice" "NotificationSound" NOT NULL DEFAULT 'CHIME',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_sound_preferences_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "user_notification_sound_preferences" ADD CONSTRAINT "user_notification_sound_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
