-- Phase 2: Escalation + Notifications

-- New enum for notification channel selection
CREATE TYPE "WhatsAppNotifyChannel" AS ENUM ('WHATSAPP', 'PUSH', 'BOTH', 'NONE');

-- WhatsAppBotConfig: add return-to-bot, be-right-with-you, and re-notify defaults
ALTER TABLE "whatsapp_bot_configs"
  ADD COLUMN "returnToBotMessage" TEXT,
  ADD COLUMN "beRightWithYouMessage" TEXT DEFAULT 'Recibí tu mensaje. La administración te responderá tan pronto sea posible.',
  ADD COLUMN "reNotifyAfterMinutes" INTEGER NOT NULL DEFAULT 5;

-- WhatsAppConversation: system-channel flag + dispatcher timestamps
ALTER TABLE "whatsapp_conversations"
  ADD COLUMN "isSystemChannel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "firstNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "reNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "beRightWithYouSentAt" TIMESTAMP(3);

CREATE INDEX "whatsapp_conversations_status_firstNotifiedAt_reNotifiedAt_idx"
  ON "whatsapp_conversations" ("status", "firstNotifiedAt", "reNotifiedAt");

-- WhatsAppNotificationPreference: per-user channel, personal phone, verification, push, override
ALTER TABLE "whatsapp_notification_preferences"
  ADD COLUMN "notifyChannel" "WhatsAppNotifyChannel" NOT NULL DEFAULT 'WHATSAPP',
  ADD COLUMN "personalPhoneNumber" TEXT,
  ADD COLUMN "personalPhoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "pushSubscriptionJson" JSONB,
  ADD COLUMN "reNotifyAfterMinutes" INTEGER;

CREATE INDEX "whatsapp_notification_preferences_condominiumId_personalPho_idx"
  ON "whatsapp_notification_preferences" ("condominiumId", "personalPhoneNumber");
