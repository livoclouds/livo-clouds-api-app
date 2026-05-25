-- AlterTable
ALTER TABLE "reconciliation_rule_change_logs"
  ADD COLUMN "previousState" JSONB,
  ADD COLUMN "newState" JSONB;
