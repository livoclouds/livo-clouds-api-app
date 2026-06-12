-- CreateTable: tenant-managed supplier category catalog (replaces hardcoded enum)
CREATE TABLE "supplier_categories" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "icon" TEXT NOT NULL DEFAULT 'briefcase',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "supplier_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_categories_condominiumId_idx" ON "supplier_categories"("condominiumId");
CREATE INDEX "supplier_categories_condominiumId_isActive_idx" ON "supplier_categories"("condominiumId", "isActive");
CREATE INDEX "supplier_categories_condominiumId_deletedAt_idx" ON "supplier_categories"("condominiumId", "deletedAt");

-- AddForeignKey
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add categoryId FK column to suppliers (nullable — existing rows without a category are NULL)
ALTER TABLE "suppliers" ADD COLUMN "categoryId" TEXT;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "supplier_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex on suppliers.categoryId
CREATE INDEX "suppliers_condominiumId_categoryId_idx" ON "suppliers"("condominiumId", "categoryId");

-- Drop old category column (safe: 0 suppliers exist in production/dev)
ALTER TABLE "suppliers" DROP COLUMN "category";

-- Give type a DB-level default so new rows created without it still satisfy NOT NULL
ALTER TABLE "suppliers" ALTER COLUMN "type" SET DEFAULT 'MAINTENANCE';

-- Drop the hardcoded SupplierCategory enum
DROP TYPE "SupplierCategory";
