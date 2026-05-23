-- INV-005: add audit-trail actor columns to inventory_items.
-- createdBy / updatedBy store the JWT `sub` of the acting user; both are
-- API-owned (set from the session, never from the request body). Nullable so
-- inventory_items rows created before this migration remain valid.

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT;
