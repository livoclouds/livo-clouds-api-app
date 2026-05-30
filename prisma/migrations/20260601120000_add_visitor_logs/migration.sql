-- RBAC Phase 4: Seguridad module — visitor entry/exit log.
-- Additive: a new table with FKs to existing condominiums/residents. No existing
-- data is touched, so no backfill is required.
CREATE TABLE "visitor_logs" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "residentId" TEXT,
    "visitorName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "plate" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "visitor_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visitor_logs_condominiumId_idx" ON "visitor_logs"("condominiumId");
CREATE INDEX "visitor_logs_condominiumId_checkOutAt_idx" ON "visitor_logs"("condominiumId", "checkOutAt");
CREATE INDEX "visitor_logs_residentId_idx" ON "visitor_logs"("residentId");
CREATE INDEX "visitor_logs_deletedAt_idx" ON "visitor_logs"("deletedAt");

ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
