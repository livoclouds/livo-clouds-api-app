-- Platform-wide R2 storage explorer: track each access (presigned URL,
-- stream, upload, delete) to expose "last accessed" metrics on the new ROOT
-- object-storage dashboard. The table is multi-tenant only by FK; rows with
-- a nullable condominium/user survive deletions of either reference.

-- CreateEnum
CREATE TYPE "R2AccessType" AS ENUM ('PRESIGNED_GET', 'PRESIGNED_PUT', 'STREAM', 'DELETE', 'UPLOAD');

-- CreateTable
CREATE TABLE "r2_access_logs" (
    "id" TEXT NOT NULL,
    "objectKey" VARCHAR(1024) NOT NULL,
    "bucket" TEXT,
    "condominiumId" TEXT,
    "userId" TEXT,
    "accessType" "R2AccessType" NOT NULL,
    "byteSize" INTEGER,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "r2_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "r2_access_logs_objectKey_accessedAt_idx" ON "r2_access_logs"("objectKey", "accessedAt");

-- CreateIndex
CREATE INDEX "r2_access_logs_condominiumId_accessedAt_idx" ON "r2_access_logs"("condominiumId", "accessedAt");

-- CreateIndex
CREATE INDEX "r2_access_logs_userId_accessedAt_idx" ON "r2_access_logs"("userId", "accessedAt");

-- CreateIndex
CREATE INDEX "r2_access_logs_accessType_idx" ON "r2_access_logs"("accessType");

-- AddForeignKey
ALTER TABLE "r2_access_logs" ADD CONSTRAINT "r2_access_logs_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "r2_access_logs" ADD CONSTRAINT "r2_access_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
