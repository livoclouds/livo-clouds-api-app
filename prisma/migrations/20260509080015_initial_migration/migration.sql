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
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('PAID_ON_TIME', 'PAID_LATE', 'PARTIAL', 'UNPAID', 'PENDING', 'ADJUSTMENT', 'EXTRAORDINARY', 'AGREEMENT');

-- CreateEnum
CREATE TYPE "UnitGeneralStatus" AS ENUM ('CURRENT', 'IN_DEBT', 'DELINQUENT', 'PARTIAL', 'CREDIT_BALANCE', 'AGREEMENT', 'NO_ACTIVITY');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEGATIVE_BALANCE', 'FILE_IMPORTED', 'IMPORT_ERROR', 'NEW_USER', 'NEW_INCIDENT');

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
    "notifyNegativeBalance" BOOLEAN NOT NULL DEFAULT true,
    "notifyNewFileImported" BOOLEAN NOT NULL DEFAULT true,
    "notifyImportError" BOOLEAN NOT NULL DEFAULT true,
    "notifyNewUser" BOOLEAN NOT NULL DEFAULT true,
    "notifyNewIncident" BOOLEAN NOT NULL DEFAULT true,

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
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
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
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
    "classificationStatus" "ClassificationStatus" NOT NULL DEFAULT 'AUTO',
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
    "condominiumId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "condominiums_slug_key" ON "condominiums"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "condominium_settings_condominiumId_key" ON "condominium_settings"("condominiumId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_condominiumId_idx" ON "users"("condominiumId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

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
CREATE INDEX "import_batches_condominiumId_idx" ON "import_batches"("condominiumId");

-- CreateIndex
CREATE INDEX "import_batches_fileHash_idx" ON "import_batches"("fileHash");

-- CreateIndex
CREATE INDEX "import_batches_status_idx" ON "import_batches"("status");

-- CreateIndex
CREATE INDEX "import_batches_createdAt_idx" ON "import_batches"("createdAt");

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

-- AddForeignKey
ALTER TABLE "condominium_settings" ADD CONSTRAINT "condominium_settings_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
