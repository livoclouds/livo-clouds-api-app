-- CreateEnum
CREATE TYPE "WhatsAppCredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "WhatsAppConversationStatus" AS ENUM ('BOT_ACTIVE', 'ESCALATED', 'ADMIN_HANDLING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppMessageType" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER', 'LOCATION', 'CONTACTS', 'INTERACTIVE', 'TEMPLATE', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "WhatsAppUnregisteredContactStatus" AS ENUM ('NEW', 'REVIEWED', 'REGISTERED', 'IGNORED');

-- CreateEnum
CREATE TYPE "WhatsAppNotifyChannel" AS ENUM ('WHATSAPP', 'PUSH', 'BOTH', 'NONE');

-- CreateTable
CREATE TABLE "whatsapp_credentials" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "phoneNumberDisplay" TEXT NOT NULL,
    "businessAccountId" TEXT NOT NULL,
    "accessTokenCiphertext" TEXT NOT NULL,
    "accessTokenIv" TEXT NOT NULL,
    "accessTokenAuthTag" TEXT NOT NULL,
    "webhookVerifyToken" TEXT NOT NULL,
    "status" "WhatsAppCredentialStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "lastWebhookReceivedAt" TIMESTAMP(3),
    "lastApiErrorAt" TIMESTAMP(3),
    "lastApiErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_bot_configs" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeMessage" TEXT NOT NULL DEFAULT '¡Hola! Soy el asistente virtual de tu condominio. ¿En qué puedo ayudarte?',
    "fallbackMessage" TEXT NOT NULL DEFAULT 'No encontré información sobre eso. Puedo intentar ayudarte con otra pregunta.',
    "escalationMessage" TEXT NOT NULL DEFAULT 'Te conectaré con un administrador en breve.',
    "offHoursMessage" TEXT NOT NULL DEFAULT 'La administración está fuera de horario. Próximo horario: {{nextDay}} a las {{nextTime}}.',
    "escalationKeywords" TEXT[] DEFAULT ARRAY['admin', 'humano', 'persona', 'ayuda']::TEXT[],
    "identityCaptureEnabled" BOOLEAN NOT NULL DEFAULT true,
    "identityCapturePrompt" TEXT NOT NULL DEFAULT 'Para brindarte mejor atención, ¿podrías indicarme tu número de departamento y nombre?',
    "whitelistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whitelistedPhoneNumbers" TEXT[],
    "conversationRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "returnToBotMessage" TEXT,
    "beRightWithYouMessage" TEXT DEFAULT 'Recibí tu mensaje. La administración te responderá tan pronto sea posible.',
    "reNotifyAfterMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_bot_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_faqs" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "category" TEXT,
    "triggers" TEXT[],
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "residentId" TEXT,
    "unregisteredContactId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "contactName" TEXT,
    "status" "WhatsAppConversationStatus" NOT NULL DEFAULT 'BOT_ACTIVE',
    "isOutOfHoursQueue" BOOLEAN NOT NULL DEFAULT false,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "takenOverByUserId" TEXT,
    "takenOverAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "consecutiveFaqMisses" INTEGER NOT NULL DEFAULT 0,
    "unreadCountForAdmin" INTEGER NOT NULL DEFAULT 0,
    "isSystemChannel" BOOLEAN NOT NULL DEFAULT false,
    "firstNotifiedAt" TIMESTAMP(3),
    "reNotifiedAt" TIMESTAMP(3),
    "beRightWithYouSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "messageType" "WhatsAppMessageType" NOT NULL DEFAULT 'TEXT',
    "textContent" TEXT,
    "mediaMetaId" TEXT,
    "mediaMimeType" TEXT,
    "mediaFilename" TEXT,
    "mediaCaption" TEXT,
    "mediaSizeBytes" INTEGER,
    "sentByBot" BOOLEAN NOT NULL DEFAULT false,
    "sentByUserId" TEXT,
    "metaMessageId" TEXT NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_unregistered_contacts" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "capturedUnitNumber" TEXT,
    "capturedName" TEXT,
    "conversationCount" INTEGER NOT NULL DEFAULT 1,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "status" "WhatsAppUnregisteredContactStatus" NOT NULL DEFAULT 'NEW',
    "registeredResidentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_unregistered_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "notifyOnEscalation" BOOLEAN NOT NULL DEFAULT true,
    "notifyChannel" "WhatsAppNotifyChannel" NOT NULL DEFAULT 'WHATSAPP',
    "personalPhoneNumber" TEXT,
    "personalPhoneVerifiedAt" TIMESTAMP(3),
    "pushSubscriptionJson" JSONB,
    "reNotifyAfterMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_credentials_condominiumId_key" ON "whatsapp_credentials"("condominiumId");

-- CreateIndex
CREATE INDEX "whatsapp_credentials_status_idx" ON "whatsapp_credentials"("status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_bot_configs_condominiumId_key" ON "whatsapp_bot_configs"("condominiumId");

-- CreateIndex
CREATE INDEX "whatsapp_faqs_condominiumId_isActive_sortOrder_idx" ON "whatsapp_faqs"("condominiumId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "whatsapp_faqs_condominiumId_category_idx" ON "whatsapp_faqs"("condominiumId", "category");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_condominiumId_status_lastInboundAt_idx" ON "whatsapp_conversations"("condominiumId", "status", "lastInboundAt");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_condominiumId_residentId_idx" ON "whatsapp_conversations"("condominiumId", "residentId");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_condominiumId_unregisteredContactId_idx" ON "whatsapp_conversations"("condominiumId", "unregisteredContactId");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_status_firstNotifiedAt_reNotifiedAt_idx" ON "whatsapp_conversations"("status", "firstNotifiedAt", "reNotifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_conversations_condominiumId_phoneNumber_status_key" ON "whatsapp_conversations"("condominiumId", "phoneNumber", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_metaMessageId_key" ON "whatsapp_messages"("metaMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_conversationId_createdAt_idx" ON "whatsapp_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_messages_status_idx" ON "whatsapp_messages"("status");

-- CreateIndex
CREATE INDEX "whatsapp_unregistered_contacts_condominiumId_status_lastSee_idx" ON "whatsapp_unregistered_contacts"("condominiumId", "status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_unregistered_contacts_condominiumId_phoneNumber_key" ON "whatsapp_unregistered_contacts"("condominiumId", "phoneNumber");

-- CreateIndex
CREATE INDEX "whatsapp_notification_preferences_condominiumId_personalPho_idx" ON "whatsapp_notification_preferences"("condominiumId", "personalPhoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_notification_preferences_userId_condominiumId_key" ON "whatsapp_notification_preferences"("userId", "condominiumId");

-- AddForeignKey
ALTER TABLE "whatsapp_credentials" ADD CONSTRAINT "whatsapp_credentials_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_bot_configs" ADD CONSTRAINT "whatsapp_bot_configs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_faqs" ADD CONSTRAINT "whatsapp_faqs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_faqs" ADD CONSTRAINT "whatsapp_faqs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_faqs" ADD CONSTRAINT "whatsapp_faqs_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_takenOverByUserId_fkey" FOREIGN KEY ("takenOverByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_unregisteredContactId_fkey" FOREIGN KEY ("unregisteredContactId") REFERENCES "whatsapp_unregistered_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_unregistered_contacts" ADD CONSTRAINT "whatsapp_unregistered_contacts_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_notification_preferences" ADD CONSTRAINT "whatsapp_notification_preferences_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_notification_preferences" ADD CONSTRAINT "whatsapp_notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

