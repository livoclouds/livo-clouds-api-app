-- CreateEnum
CREATE TYPE "SupplierCategory" AS ENUM ('ADMINISTRATION', 'SURVEILLANCE', 'GARDENING', 'CLEANING', 'MAINTENANCE', 'SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierEngagement" AS ENUM ('FIXED', 'OCCASIONAL');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "availability" TEXT,
ADD COLUMN     "category" "SupplierCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "engagementType" "SupplierEngagement" NOT NULL DEFAULT 'OCCASIONAL',
ADD COLUMN     "references" TEXT,
ADD COLUMN     "servesResidents" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp" TEXT;

-- Backfill the coarse directory `category` from the legacy fine-grained `type`
-- for rows that pre-date this column (new rows default to OTHER and are set
-- explicitly by the API). `engagementType` intentionally stays OCCASIONAL.
UPDATE "suppliers" SET "category" = (
  CASE "type"
    WHEN 'ADMINISTRATION' THEN 'ADMINISTRATION'
    WHEN 'SECURITY'       THEN 'SURVEILLANCE'
    WHEN 'LANDSCAPING'    THEN 'GARDENING'
    WHEN 'CLEANING'       THEN 'CLEANING'
    WHEN 'MAINTENANCE'    THEN 'MAINTENANCE'
    WHEN 'PLUMBING'       THEN 'MAINTENANCE'
    WHEN 'ELECTRICAL'     THEN 'MAINTENANCE'
    WHEN 'PAINTING'       THEN 'MAINTENANCE'
    WHEN 'ELEVATOR'       THEN 'MAINTENANCE'
    WHEN 'TECHNOLOGY'     THEN 'SERVICES'
    ELSE 'OTHER'
  END
)::"SupplierCategory";

-- CreateTable
CREATE TABLE "supplier_ratings" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_ratings_supplierId_idx" ON "supplier_ratings"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_ratings_condominiumId_supplierId_idx" ON "supplier_ratings"("condominiumId", "supplierId");

-- CreateIndex
CREATE INDEX "suppliers_condominiumId_category_idx" ON "suppliers"("condominiumId", "category");

-- CreateIndex
CREATE INDEX "suppliers_condominiumId_engagementType_idx" ON "suppliers"("condominiumId", "engagementType");

-- AddForeignKey
ALTER TABLE "supplier_ratings" ADD CONSTRAINT "supplier_ratings_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ratings" ADD CONSTRAINT "supplier_ratings_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
