-- CreateEnum
CREATE TYPE "ReconciliationRuleKind" AS ENUM ('CONCEPT', 'UNIT');

-- AlterTable
ALTER TABLE "reconciliation_rules" ADD COLUMN     "assignedUnitNumber" TEXT,
ADD COLUMN     "ruleKind" "ReconciliationRuleKind" NOT NULL DEFAULT 'CONCEPT',
ADD COLUMN     "unitExtractionGroup" INTEGER DEFAULT 1,
ADD COLUMN     "unitExtractionPattern" TEXT;

-- CreateIndex
CREATE INDEX "reconciliation_rules_condominiumId_ruleKind_idx" ON "reconciliation_rules"("condominiumId", "ruleKind");
