-- Add ReconciliationStatus enum and reconciliation tracking fields to transactions.
-- Separates "how was the transaction classified" (classificationStatus) from
-- "has an admin approved this transaction to affect official financial data" (reconciliationStatus).
-- Only APPROVED transactions are included in FinancialMonthlySummary income/expense totals.

CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'APPROVED', 'IGNORED');

ALTER TABLE "transactions"
  ADD COLUMN "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reconciledById" TEXT,
  ADD COLUMN "reconciledAt" TIMESTAMP(3);

CREATE INDEX "transactions_condominiumId_reconciliationStatus_idx"
  ON "transactions"("condominiumId", "reconciliationStatus");

CREATE INDEX "transactions_condominiumId_reconciliationStatus_transactionDate_idx"
  ON "transactions"("condominiumId", "reconciliationStatus", "transactionDate");

ALTER TABLE "financial_monthly_summaries"
  ADD COLUMN "approvedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pendingCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ignoredCount"  INTEGER NOT NULL DEFAULT 0;
