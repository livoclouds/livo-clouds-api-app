-- Track every create/update/delete/toggle of reconciliation rules so the web
-- app can show "rules changed since the last reapply" in Settings and in the
-- Imports > Por revisar banner, and so reapply-to-pending can mark them all
-- as applied in one shot. Rows survive rule deletion (ruleId is nullable);
-- ruleName is snapshotted so the UI can still display "Cuota mensual" after
-- the underlying rule is gone.

-- CreateEnum
CREATE TYPE "RuleChangeAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'TOGGLED');

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

    CONSTRAINT "reconciliation_rule_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_rule_change_logs_condominiumId_appliedAt_idx" ON "reconciliation_rule_change_logs"("condominiumId", "appliedAt");

-- CreateIndex
CREATE INDEX "reconciliation_rule_change_logs_condominiumId_changedAt_idx" ON "reconciliation_rule_change_logs"("condominiumId", "changedAt");

-- AddForeignKey
ALTER TABLE "reconciliation_rule_change_logs" ADD CONSTRAINT "reconciliation_rule_change_logs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
