-- CreateEnum
CREATE TYPE "ArcoRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'CANCELLATION', 'OPPOSITION');

-- CreateEnum
CREATE TYPE "ArcoRequestStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ArcoRequestEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'NOTE_ADDED', 'UPDATED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED', 'ACCESS_PACKET_GENERATED');

-- CreateTable
CREATE TABLE "arco_requests" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "type" "ArcoRequestType" NOT NULL,
    "status" "ArcoRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "channel" TEXT,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "referenceFolio" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arco_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arco_request_attachments" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "arcoRequestId" TEXT NOT NULL,
    "fileName" VARCHAR(512) NOT NULL,
    "storageKey" VARCHAR(1024) NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arco_request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arco_request_events" (
    "id" TEXT NOT NULL,
    "condominiumId" TEXT NOT NULL,
    "arcoRequestId" TEXT NOT NULL,
    "type" "ArcoRequestEventType" NOT NULL,
    "fromStatus" "ArcoRequestStatus",
    "toStatus" "ArcoRequestStatus",
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arco_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "arco_requests_condominiumId_idx" ON "arco_requests"("condominiumId");

-- CreateIndex
CREATE INDEX "arco_requests_residentId_idx" ON "arco_requests"("residentId");

-- CreateIndex
CREATE INDEX "arco_requests_residentId_status_idx" ON "arco_requests"("residentId", "status");

-- CreateIndex
CREATE INDEX "arco_requests_dueDate_idx" ON "arco_requests"("dueDate");

-- CreateIndex
CREATE INDEX "arco_requests_deletedAt_idx" ON "arco_requests"("deletedAt");

-- CreateIndex
CREATE INDEX "arco_request_attachments_arcoRequestId_idx" ON "arco_request_attachments"("arcoRequestId");

-- CreateIndex
CREATE INDEX "arco_request_attachments_condominiumId_idx" ON "arco_request_attachments"("condominiumId");

-- CreateIndex
CREATE INDEX "arco_request_events_arcoRequestId_idx" ON "arco_request_events"("arcoRequestId");

-- CreateIndex
CREATE INDEX "arco_request_events_condominiumId_idx" ON "arco_request_events"("condominiumId");

-- AddForeignKey
ALTER TABLE "arco_requests" ADD CONSTRAINT "arco_requests_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arco_requests" ADD CONSTRAINT "arco_requests_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arco_request_attachments" ADD CONSTRAINT "arco_request_attachments_arcoRequestId_fkey" FOREIGN KEY ("arcoRequestId") REFERENCES "arco_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arco_request_events" ADD CONSTRAINT "arco_request_events_arcoRequestId_fkey" FOREIGN KEY ("arcoRequestId") REFERENCES "arco_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
