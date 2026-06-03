-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('MAINTENANCE', 'SECURITY', 'ELECTRICAL', 'PLUMBING', 'LANDSCAPING', 'CLEANING', 'PAINTING', 'ELEVATOR', 'TECHNOLOGY', 'ADMINISTRATION');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "type" "SupplierType" NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "registrationDate" DATE,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_condominiumId_idx" ON "suppliers"("condominiumId");

-- CreateIndex
CREATE INDEX "suppliers_condominiumId_status_idx" ON "suppliers"("condominiumId", "status");

-- CreateIndex
CREATE INDEX "suppliers_condominiumId_type_idx" ON "suppliers"("condominiumId", "type");

-- CreateIndex
CREATE INDEX "suppliers_deletedAt_idx" ON "suppliers"("deletedAt");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
