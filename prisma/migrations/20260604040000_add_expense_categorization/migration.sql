-- AlterEnum
ALTER TYPE "ReconciliationRuleKind" ADD VALUE 'EXPENSE';

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "defaultExpenseCategoryId" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "expenseCategoryId" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "reconciliation_rules" ADD COLUMN     "expenseCategoryId" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemKey" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_condominiumId_idx" ON "expense_categories"("condominiumId");

-- CreateIndex
CREATE INDEX "expense_categories_condominiumId_isActive_idx" ON "expense_categories"("condominiumId", "isActive");

-- CreateIndex
CREATE INDEX "expense_categories_condominiumId_systemKey_idx" ON "expense_categories"("condominiumId", "systemKey");

-- CreateIndex
CREATE INDEX "expense_categories_deletedAt_idx" ON "expense_categories"("deletedAt");

-- CreateIndex
CREATE INDEX "suppliers_condominiumId_defaultExpenseCategoryId_idx" ON "suppliers"("condominiumId", "defaultExpenseCategoryId");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_expenseCategoryId_idx" ON "transactions"("condominiumId", "expenseCategoryId");

-- CreateIndex
CREATE INDEX "transactions_condominiumId_supplierId_idx" ON "transactions"("condominiumId", "supplierId");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_defaultExpenseCategoryId_fkey" FOREIGN KEY ("defaultExpenseCategoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

