-- INV-012: introduce soft-delete on inventory_items. `deletedAt` is null for
-- live rows and timestamps the moment removeItem flips a row to deleted. Reads
-- filter `deletedAt IS NULL` so deleted items disappear from the API surface
-- while remaining forensically recoverable. Indexed because every list/read
-- query now adds the column to its WHERE clause.

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "inventory_items_deletedAt_idx" ON "inventory_items"("deletedAt");
