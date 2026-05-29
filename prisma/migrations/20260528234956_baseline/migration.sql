-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ROOT', 'TENANT_ADMIN', 'READ_ONLY', 'GUARD', 'NEIGHBOR');

-- CreateEnum
CREATE TYPE "ResidentType" AS ENUM ('OWNER', 'CO_OWNER', 'RESIDENT', 'TENANT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CURRENT', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PetType" AS ENUM ('DOG', 'CAT', 'OTHER');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRY', 'EXIT', 'ADJUSTMENT', 'REIMBURSEMENT');

-- CreateEnum
CREATE TYPE "MovementCategory" AS ENUM ('CLEANING', 'STATIONERY', 'INTERNET', 'WATER', 'CAFETERIA', 'GATEHOUSE', 'GARDENING', 'MAINTENANCE', 'TOOLS', 'SERVICES', 'URGENT_PURCHASES', 'OTHER');

-- CreateEnum
CREATE TYPE "MovementStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('CASH', 'TRANSFER', 'CHECK');

-- CreateEnum
CREATE TYPE "CommonAreaStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'CLOSED');

-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('FURNITURE', 'ELECTRONICS', 'APPLIANCES', 'TOOLS', 'SECURITY', 'COMMUNICATIONS', 'OFFICE', 'CLEANING', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'REPAIR', 'OUT_OF_SERVICE', 'LOST', 'DISPOSED');

-- CreateEnum
CREATE TYPE "FlowType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ClassificationStatus" AS ENUM ('AUTO', 'MANUAL_OVERRIDE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "MatchSource" AS ENUM ('AUTO_UNIT_NUMBER', 'AUTO_NAME', 'AUTO_AMOUNT_DATE', 'MANUAL', 'RULE', 'AUTO_TERRACE_BOOKING');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('PAID_ON_TIME', 'PAID_LATE', 'PARTIAL', 'UNPAID', 'PENDING', 'ADJUSTMENT', 'EXTRAORDINARY', 'AGREEMENT');

-- CreateEnum
CREATE TYPE "UnitGeneralStatus" AS ENUM ('CURRENT', 'IN_DEBT', 'DELINQUENT', 'PARTIAL', 'CREDIT_BALANCE', 'AGREEMENT', 'NO_ACTIVITY');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEGATIVE_BALANCE', 'FILE_IMPORTED', 'IMPORT_ERROR', 'NEW_USER', 'NEW_INCIDENT', 'IMPORT_COMPLETED', 'IMPORT_FAILED', 'IMPORT_WITH_WARNINGS', 'IMPORT_DUPLICATE', 'CLASSIFICATION_REVIEW', 'RECONCILIATION_RULE_MODIFIED', 'CALENDAR_EVENT_CREATED', 'CALENDAR_EVENT_CANCELLED', 'CALENDAR_BOOKING_CONFIRMED', 'USER_ADDED', 'PERMISSIONS_CHANGED', 'SESSION_EXPIRING');

-- CreateEnum
CREATE TYPE "RootScope" AS ENUM ('ACTIVE_TENANT', 'ALL', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "RequiresReviewReason" AS ENUM ('UNIT_NOT_FOUND', 'UNIT_AMBIGUOUS', 'NAME_NOT_FOUND', 'NAME_AMBIGUOUS', 'LOW_CONFIDENCE', 'NO_MATCH', 'TERRACE_AMBIGUOUS', 'MANUAL_UNMATCHED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'APPROVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('TERRACE_BOOKING', 'ASSEMBLY', 'COUNCIL_MEETING', 'MAINTENANCE', 'PROVIDER', 'GENERAL');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarEventVisibility" AS ENUM ('PUBLIC', 'COUNCIL_ONLY', 'PRIVATE');

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

-- CreateEnum
CREATE TYPE "R2AccessType" AS ENUM ('PRESIGNED_GET', 'PRESIGNED_PUT', 'STREAM', 'DELETE', 'UPLOAD');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RuleChangeAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'TOGGLED', 'REORDERED');

-- CreateTable
CREATE TABLE "condominiums" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#6366f1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "condominiums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "condominium_settings" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "logoUrl" TEXT,
    "logoUpdatedAt" TIMESTAMP(3),
    "logoUpdatedByName" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Monterrey',
    "country" TEXT NOT NULL DEFAULT 'MX',
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "address" TEXT,
    "adminPhone" TEXT,
    "contactEmail" TEXT,
    "businessHours" JSONB NOT NULL DEFAULT '{}',
    "defaultLocale" TEXT NOT NULL DEFAULT 'es',
    "totalUnits" INTEGER NOT NULL DEFAULT 1,
    "ordinaryFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extraordinaryFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "ordinaryPaymentDayStart" INTEGER NOT NULL DEFAULT 1,
    "ordinaryPaymentDayEnd" INTEGER NOT NULL DEFAULT 10,
    "lateFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lateFeeStartDay" INTEGER NOT NULL DEFAULT 11,
    "maxFilesPerImport" INTEGER NOT NULL DEFAULT 5,
    "allowedFilePdf" BOOLEAN NOT NULL DEFAULT true,
    "allowedFileExcel" BOOLEAN NOT NULL DEFAULT true,
    "terraceBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "terraceRentalAmount" DECIMAL(12,2) NOT NULL DEFAULT 1500,
    "terraceSecurityDepositAmount" DECIMAL(12,2) NOT NULL DEFAULT 1000,
    "terraceDefaultStartTime" TEXT NOT NULL DEFAULT '10:00',
    "terraceDefaultEndTime" TEXT NOT NULL DEFAULT '11:00',
    "terraceGlobalKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "condominium_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "sessionDuration" INTEGER NOT NULL DEFAULT 8,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardingCompletedAt" TIMESTAMP(3),
    "onboardingSkippedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "residents" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "residentType" "ResidentType" NOT NULL DEFAULT 'OWNER',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "secondaryPhone" TEXT,
    "email" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'CURRENT',
    "debt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "parkingSpots" INTEGER NOT NULL DEFAULT 0,
    "documentation" JSONB NOT NULL DEFAULT '{"propertyTax":false,"titleDeed":false,"ownerDocumentation":false,"nationalId":false,"proofOfAddress":false}',
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "residents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_residents" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "residentType" "ResidentType" NOT NULL DEFAULT 'RESIDENT',
    "phone" TEXT,
    "secondaryPhone" TEXT,
    "email" TEXT,
    "relationship" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "additional_residents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT,
    "plates" TEXT NOT NULL,
    "hasTag" BOOLEAN NOT NULL DEFAULT false,
    "tagId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pets" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "petType" "PetType" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petty_cash_movements" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "category" "MovementCategory" NOT NULL,
    "concept" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "runningBalance" DECIMAL(12,2) NOT NULL,
    "status" "MovementStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryMethod" "DeliveryMethod" NOT NULL DEFAULT 'CASH',
    "responsible" TEXT NOT NULL,
    "supplier" TEXT,
    "hasReceipt" BOOLEAN NOT NULL DEFAULT false,
    "receiptNumber" TEXT,
    "authorizedBy" TEXT,
    "notes" TEXT,
    "registeredById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "petty_cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "common_areas" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT,
    "description" TEXT,
    "physicalLocation" TEXT,
    "status" "CommonAreaStatus" NOT NULL DEFAULT 'ACTIVE',
    "responsiblePerson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "common_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "commonAreaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "InventoryCategory" NOT NULL DEFAULT 'OTHER',
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "condition" "InventoryCondition" NOT NULL DEFAULT 'GOOD',
    "purchaseDate" DATE,
    "approximateCost" DECIMAL(12,2),
    "supplier" TEXT,
    "hasInvoice" BOOLEAN NOT NULL DEFAULT false,
    "invoiceNumber" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
    "bankProfileId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "totalIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalExpenses" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "finalBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "storageKey" TEXT,
    "storageProvider" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_profiles" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "useSameForPdf" BOOLEAN NOT NULL DEFAULT true,
    "excelAliases" JSONB NOT NULL,
    "pdfAliases" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "bank_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "residentId" TEXT,
    "transactionDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "charges" DECIMAL(12,2),
    "credits" DECIMAL(12,2),
    "balance" DECIMAL(12,2) NOT NULL,
    "flowType" "FlowType" NOT NULL,
    "category" TEXT,
    "reference" TEXT,
    "payerName" TEXT,
    "classificationStatus" "ClassificationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "unitNumberDetected" TEXT,
    "payerNameDetected" TEXT,
    "paymentConcept" TEXT,
    "paymentPeriodYear" INTEGER,
    "paymentPeriodMonth" INTEGER,
    "matchSource" "MatchSource",
    "confidenceScore" DECIMAL(5,4),
    "matchedAt" TIMESTAMP(3),
    "classificationVersion" INTEGER NOT NULL DEFAULT 1,
    "requiresReviewReason" "RequiresReviewReason",
    "matchedRuleId" TEXT,
    "matchedCalendarEventId" TEXT,
    "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "reconciledById" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_records" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "CollectionStatus" NOT NULL DEFAULT 'PENDING',
    "generalStatus" "UnitGeneralStatus" NOT NULL DEFAULT 'CURRENT',
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountExpected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentDate" DATE,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "suggestedAction" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actionCategory" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "result" "AuditResult" NOT NULL DEFAULT 'SUCCESS',
    "description" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT,
    "userId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "data" JSONB,
    "linkUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "aggregateCount" INTEGER NOT NULL DEFAULT 1,
    "aggregateUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "root_notification_scopes" (
    "userId" TEXT NOT NULL,
    "scope" "RootScope" NOT NULL DEFAULT 'ACTIVE_TENANT',
    "condominiumIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "root_notification_scopes_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "financial_monthly_summaries" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalExpenses" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "classifiedCount" INTEGER NOT NULL DEFAULT 0,
    "needsReviewCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_monthly_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_rules" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "unitPatterns" TEXT[],
    "conceptType" TEXT,
    "confidenceThreshold" DECIMAL(3,2) NOT NULL DEFAULT 0.80,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_rule_change_logs" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT NOT NULL,
    "action" "RuleChangeAction" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedByUserId" TEXT,
    "previousState" JSONB,
    "newState" JSONB,

    CONSTRAINT "reconciliation_rule_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "paymentPeriodYear" INTEGER NOT NULL,
    "paymentPeriodMonth" INTEGER NOT NULL,
    "allocatedAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_correction_patterns" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "originalDescription" TEXT NOT NULL,
    "selectedUnitNumber" TEXT,
    "selectedResidentId" TEXT,
    "selectedConcept" TEXT,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_correction_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventType" "EventType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "unitNumber" TEXT,
    "residentId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "metadata" JSONB,
    "recurrenceRule" TEXT,
    "parentEventId" TEXT,
    "timezone" TEXT,
    "visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'PUBLIC',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

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
    "identityPromptSentAt" TIMESTAMP(3),
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

-- CreateTable
CREATE TABLE "r2_access_logs" (
    "id" TEXT NOT NULL,
    "objectKey" VARCHAR(1024) NOT NULL,
    "bucket" TEXT,
    "condominiumId" TEXT,
    "userId" TEXT,
    "accessType" "R2AccessType" NOT NULL,
    "byteSize" INTEGER,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "r2_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "condominiums_slug_key" ON "condominiums"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "condominium_settings_condominiumId_key" ON "condominium_settings"("condominiumId");

-- CreateIndex
CREATE INDEX "users_condominiumId_idx" ON "users"("condominiumId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_condominiumId_email_key" ON "users"("condominiumId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "residents_condominiumId_idx" ON "residents"("condominiumId");

-- CreateIndex
CREATE INDEX "residents_paymentStatus_idx" ON "residents"("paymentStatus");

-- CreateIndex
CREATE INDEX "residents_deletedAt_idx" ON "residents"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "residents_condominiumId_unitNumber_key" ON "residents"("condominiumId", "unitNumber");

-- CreateIndex
CREATE INDEX "additional_residents_residentId_idx" ON "additional_residents"("residentId");

-- CreateIndex
CREATE INDEX "vehicles_residentId_idx" ON "vehicles"("residentId");

-- CreateIndex
CREATE INDEX "vehicles_condominiumId_idx" ON "vehicles"("condominiumId");

-- CreateIndex
CREATE INDEX "vehicles_plates_idx" ON "vehicles"("plates");

-- CreateIndex
CREATE INDEX "pets_residentId_idx" ON "pets"("residentId");

-- CreateIndex
CREATE INDEX "pets_condominiumId_idx" ON "pets"("condominiumId");

-- CreateIndex
CREATE INDEX "petty_cash_movements_condominiumId_idx" ON "petty_cash_movements"("condominiumId");

-- CreateIndex
CREATE INDEX "petty_cash_movements_status_idx" ON "petty_cash_movements"("status");

-- CreateIndex
CREATE INDEX "petty_cash_movements_date_idx" ON "petty_cash_movements"("date");

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_movements_condominiumId_folio_key" ON "petty_cash_movements"("condominiumId", "folio");

-- CreateIndex
CREATE INDEX "common_areas_condominiumId_idx" ON "common_areas"("condominiumId");

-- CreateIndex
CREATE INDEX "common_areas_status_idx" ON "common_areas"("status");

-- CreateIndex
CREATE INDEX "inventory_items_condominiumId_idx" ON "inventory_items"("condominiumId");

-- CreateIndex
CREATE INDEX "inventory_items_commonAreaId_idx" ON "inventory_items"("commonAreaId");

-- CreateIndex
CREATE INDEX "inventory_items_condition_idx" ON "inventory_items"("condition");

-- CreateIndex
CREATE INDEX "inventory_items_deletedAt_idx" ON "inventory_items"("deletedAt");

-- CreateIndex
CREATE INDEX "import_batches_condominiumId_idx" ON "import_batches"("condominiumId");

-- CreateIndex
CREATE INDEX "import_batches_fileHash_idx" ON "import_batches"("fileHash");

-- CreateIndex
CREATE INDEX "import_batches_status_idx" ON "import_batches"("status");

-- CreateIndex
CREATE INDEX "import_batches_createdAt_idx" ON "import_batches"("createdAt");

-- CreateIndex
CREATE INDEX "import_batches_bankProfileId_idx" ON "import_batches"("bankProfileId");

-- CreateIndex
CREATE INDEX "bank_profiles_condominiumId_isActive_idx" ON "bank_profiles"("condominiumId", "isActive");

-- CreateIndex
CREATE INDEX "bank_profiles_condominiumId_isDefault_idx" ON "bank_profiles"("condominiumId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "bank_profiles_condominiumId_name_key" ON "bank_profiles"("condominiumId", "name");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_idx" ON "transactions"("condominiumId");

-- CreateIndex
CREATE INDEX "transactions_importBatchId_idx" ON "transactions"("importBatchId");

-- CreateIndex
CREATE INDEX "transactions_residentId_idx" ON "transactions"("residentId");

-- CreateIndex
CREATE INDEX "transactions_transactionDate_idx" ON "transactions"("transactionDate");

-- CreateIndex
CREATE INDEX "transactions_flowType_idx" ON "transactions"("flowType");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_classificationStatus_idx" ON "transactions"("condominiumId", "classificationStatus");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_transactionDate_flowType_idx" ON "transactions"("condominiumId", "transactionDate", "flowType");

-- CreateIndex
CREATE INDEX "transactions_residentId_paymentPeriodYear_paymentPeriodMont_idx" ON "transactions"("residentId", "paymentPeriodYear", "paymentPeriodMonth");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_paymentPeriodYear_paymentPeriodM_idx" ON "transactions"("condominiumId", "paymentPeriodYear", "paymentPeriodMonth");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_requiresReviewReason_idx" ON "transactions"("condominiumId", "requiresReviewReason");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_reconciliationStatus_idx" ON "transactions"("condominiumId", "reconciliationStatus");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_reconciliationStatus_transaction_idx" ON "transactions"("condominiumId", "reconciliationStatus", "transactionDate");

-- CreateIndex
CREATE INDEX "transactions_matchedCalendarEventId_idx" ON "transactions"("matchedCalendarEventId");

-- CreateIndex
CREATE INDEX "collection_records_condominiumId_idx" ON "collection_records"("condominiumId");

-- CreateIndex
CREATE INDEX "collection_records_residentId_idx" ON "collection_records"("residentId");

-- CreateIndex
CREATE INDEX "collection_records_year_month_idx" ON "collection_records"("year", "month");

-- CreateIndex
CREATE INDEX "collection_records_status_idx" ON "collection_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "collection_records_condominiumId_residentId_year_month_key" ON "collection_records"("condominiumId", "residentId", "year", "month");

-- CreateIndex
CREATE INDEX "audit_logs_condominiumId_idx" ON "audit_logs"("condominiumId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_module_idx" ON "audit_logs"("module");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_result_idx" ON "audit_logs"("result");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_condominiumId_idx" ON "notifications"("condominiumId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_type_aggregateUntil_idx" ON "notifications"("userId", "type", "aggregateUntil");

-- CreateIndex
CREATE INDEX "user_notification_preferences_userId_idx" ON "user_notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_preferences_userId_type_key" ON "user_notification_preferences"("userId", "type");

-- CreateIndex
CREATE INDEX "financial_monthly_summaries_condominiumId_idx" ON "financial_monthly_summaries"("condominiumId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_monthly_summaries_condominiumId_year_month_key" ON "financial_monthly_summaries"("condominiumId", "year", "month");

-- CreateIndex
CREATE INDEX "reconciliation_rules_condominiumId_isActive_idx" ON "reconciliation_rules"("condominiumId", "isActive");

-- CreateIndex
CREATE INDEX "reconciliation_rules_condominiumId_priority_idx" ON "reconciliation_rules"("condominiumId", "priority");

-- CreateIndex
CREATE INDEX "reconciliation_rule_change_logs_condominiumId_appliedAt_idx" ON "reconciliation_rule_change_logs"("condominiumId", "appliedAt");

-- CreateIndex
CREATE INDEX "reconciliation_rule_change_logs_condominiumId_changedAt_idx" ON "reconciliation_rule_change_logs"("condominiumId", "changedAt");

-- CreateIndex
CREATE INDEX "payment_allocations_condominiumId_idx" ON "payment_allocations"("condominiumId");

-- CreateIndex
CREATE INDEX "payment_allocations_transactionId_idx" ON "payment_allocations"("transactionId");

-- CreateIndex
CREATE INDEX "payment_allocations_residentId_paymentPeriodYear_paymentPer_idx" ON "payment_allocations"("residentId", "paymentPeriodYear", "paymentPeriodMonth");

-- CreateIndex
CREATE INDEX "reconciliation_correction_patterns_condominiumId_idx" ON "reconciliation_correction_patterns"("condominiumId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_correction_patterns_condominiumId_originalDe_key" ON "reconciliation_correction_patterns"("condominiumId", "originalDescription");

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_idx" ON "calendar_events"("condominiumId");

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_startDate_endDate_idx" ON "calendar_events"("condominiumId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_eventType_idx" ON "calendar_events"("condominiumId", "eventType");

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_parentEventId_idx" ON "calendar_events"("condominiumId", "parentEventId");

-- CreateIndex
CREATE INDEX "calendar_events_deletedAt_idx" ON "calendar_events"("deletedAt");

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

-- CreateIndex
CREATE INDEX "r2_access_logs_objectKey_accessedAt_idx" ON "r2_access_logs"("objectKey", "accessedAt");

-- CreateIndex
CREATE INDEX "r2_access_logs_condominiumId_accessedAt_idx" ON "r2_access_logs"("condominiumId", "accessedAt");

-- CreateIndex
CREATE INDEX "r2_access_logs_userId_accessedAt_idx" ON "r2_access_logs"("userId", "accessedAt");

-- CreateIndex
CREATE INDEX "r2_access_logs_accessType_idx" ON "r2_access_logs"("accessType");

-- AddForeignKey
ALTER TABLE "condominium_settings" ADD CONSTRAINT "condominium_settings_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_residents" ADD CONSTRAINT "additional_residents_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_movements" ADD CONSTRAINT "petty_cash_movements_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_movements" ADD CONSTRAINT "petty_cash_movements_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_movements" ADD CONSTRAINT "petty_cash_movements_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "common_areas" ADD CONSTRAINT "common_areas_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_commonAreaId_fkey" FOREIGN KEY ("commonAreaId") REFERENCES "common_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_bankProfileId_fkey" FOREIGN KEY ("bankProfileId") REFERENCES "bank_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_profiles" ADD CONSTRAINT "bank_profiles_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_matchedRuleId_fkey" FOREIGN KEY ("matchedRuleId") REFERENCES "reconciliation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_matchedCalendarEventId_fkey" FOREIGN KEY ("matchedCalendarEventId") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "root_notification_scopes" ADD CONSTRAINT "root_notification_scopes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_monthly_summaries" ADD CONSTRAINT "financial_monthly_summaries_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rule_change_logs" ADD CONSTRAINT "reconciliation_rule_change_logs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_correction_patterns" ADD CONSTRAINT "reconciliation_correction_patterns_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_correction_patterns" ADD CONSTRAINT "reconciliation_correction_patterns_selectedResidentId_fkey" FOREIGN KEY ("selectedResidentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "r2_access_logs" ADD CONSTRAINT "r2_access_logs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "r2_access_logs" ADD CONSTRAINT "r2_access_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

