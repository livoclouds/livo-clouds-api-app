-- CMA-006: add audit-trail actor columns to common_areas.
-- createdBy / updatedBy store the JWT `sub` of the acting user; both are
-- API-owned (set from the session, never from the request body). Nullable so
-- common_areas rows created before this migration remain valid.

-- AlterTable
ALTER TABLE "common_areas" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT;
