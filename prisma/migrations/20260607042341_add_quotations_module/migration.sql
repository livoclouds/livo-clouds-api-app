-- CreateEnum
CREATE TYPE "QuotationCategory" AS ENUM ('carpentry', 'hardware', 'gateRepair', 'masonry', 'gardening', 'surveillance', 'lighting', 'stationery', 'signage', 'painting', 'other');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('received', 'pendingReview', 'providerSelected', 'inProgress', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "quotation_requests" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" "QuotationCategory" NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'received',
    "targetStartDate" DATE,
    "targetEndDate" DATE,
    "selectedQuotationId" TEXT,
    "beforePhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "afterPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comments" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerPhone" TEXT,
    "providerEmail" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "quoteDate" DATE NOT NULL,
    "estimatedStartDate" DATE,
    "estimatedEndDate" DATE,
    "documentUrl" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_requests_condominiumId_idx" ON "quotation_requests"("condominiumId");

-- CreateIndex
CREATE INDEX "quotation_requests_condominiumId_status_idx" ON "quotation_requests"("condominiumId", "status");

-- CreateIndex
CREATE INDEX "quotation_requests_condominiumId_category_idx" ON "quotation_requests"("condominiumId", "category");

-- CreateIndex
CREATE INDEX "quotation_requests_deletedAt_idx" ON "quotation_requests"("deletedAt");

-- CreateIndex
CREATE INDEX "quotations_requestId_idx" ON "quotations"("requestId");

-- CreateIndex
CREATE INDEX "quotations_condominiumId_idx" ON "quotations"("condominiumId");

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "quotation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
