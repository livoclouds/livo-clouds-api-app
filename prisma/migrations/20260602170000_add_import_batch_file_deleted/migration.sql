-- Track when an import batch's original source file is deleted from object
-- storage (e.g. by a ROOT via the storage-admin module). The batch and its
-- transactions are retained as financial history; only the downloadable source
-- file is gone. fileDeletedById records which user performed the deletion.
ALTER TABLE "import_batches" ADD COLUMN "fileDeletedAt" TIMESTAMP(3);
ALTER TABLE "import_batches" ADD COLUMN "fileDeletedById" TEXT;

-- CreateIndex
CREATE INDEX "import_batches_fileDeletedById_idx" ON "import_batches"("fileDeletedById");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_fileDeletedById_fkey" FOREIGN KEY ("fileDeletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
