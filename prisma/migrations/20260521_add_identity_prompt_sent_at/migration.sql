-- Phase 3 (Communications): identity-capture idempotency marker.
-- identityPromptSentAt records when the bot sent the one-time identity-capture
-- prompt to an unregistered contact, so the prompt is never re-sent.
ALTER TABLE "whatsapp_unregistered_contacts" ADD COLUMN "identityPromptSentAt" TIMESTAMP(3);
