-- CreateTable
CREATE TABLE "dossier_attachments" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "dossierEntryId" TEXT NOT NULL,
    "fileName" VARCHAR(512) NOT NULL,
    "storageKey" VARCHAR(1024) NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dossier_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dossier_attachments_dossierEntryId_idx" ON "dossier_attachments"("dossierEntryId");

-- CreateIndex
CREATE INDEX "dossier_attachments_condominiumId_idx" ON "dossier_attachments"("condominiumId");

-- AddForeignKey
ALTER TABLE "dossier_attachments" ADD CONSTRAINT "dossier_attachments_dossierEntryId_fkey" FOREIGN KEY ("dossierEntryId") REFERENCES "resident_dossier_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
