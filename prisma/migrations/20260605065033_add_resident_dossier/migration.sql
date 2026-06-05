-- CreateEnum
CREATE TYPE "DossierCategory" AS ENUM ('SANCTION', 'LEGAL', 'COEXISTENCE', 'PROPERTY', 'DANGEROUS_PET');

-- CreateEnum
CREATE TYPE "DossierSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DossierStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DossierConfidentiality" AS ENUM ('STANDARD', 'RESTRICTED', 'LEGAL_CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "DossierEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'NOTE_ADDED', 'UPDATED');

-- CreateTable
CREATE TABLE "resident_dossier_entries" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "category" "DossierCategory" NOT NULL,
    "severity" "DossierSeverity" NOT NULL DEFAULT 'LOW',
    "status" "DossierStatus" NOT NULL DEFAULT 'OPEN',
    "confidentiality" "DossierConfidentiality" NOT NULL DEFAULT 'STANDARD',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "referenceFolio" TEXT,
    "amount" DECIMAL(12,2),
    "occurredAt" DATE NOT NULL,
    "resolvedAt" DATE,
    "metadata" JSONB,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resident_dossier_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dossier_events" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "dossierEntryId" TEXT NOT NULL,
    "type" "DossierEventType" NOT NULL,
    "fromStatus" "DossierStatus",
    "toStatus" "DossierStatus",
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dossier_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resident_dossier_entries_condominiumId_idx" ON "resident_dossier_entries"("condominiumId");

-- CreateIndex
CREATE INDEX "resident_dossier_entries_residentId_idx" ON "resident_dossier_entries"("residentId");

-- CreateIndex
CREATE INDEX "resident_dossier_entries_residentId_category_idx" ON "resident_dossier_entries"("residentId", "category");

-- CreateIndex
CREATE INDEX "resident_dossier_entries_confidentiality_idx" ON "resident_dossier_entries"("confidentiality");

-- CreateIndex
CREATE INDEX "resident_dossier_entries_deletedAt_idx" ON "resident_dossier_entries"("deletedAt");

-- CreateIndex
CREATE INDEX "dossier_events_dossierEntryId_idx" ON "dossier_events"("dossierEntryId");

-- CreateIndex
CREATE INDEX "dossier_events_condominiumId_idx" ON "dossier_events"("condominiumId");

-- AddForeignKey
ALTER TABLE "resident_dossier_entries" ADD CONSTRAINT "resident_dossier_entries_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_dossier_entries" ADD CONSTRAINT "resident_dossier_entries_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier_events" ADD CONSTRAINT "dossier_events_dossierEntryId_fkey" FOREIGN KEY ("dossierEntryId") REFERENCES "resident_dossier_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
