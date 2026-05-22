-- RES-012: give Pet direct tenant-isolation depth (parity with Vehicle).
-- Pet mutations previously filtered only by residentId and depended on an
-- upstream parent-resident lookup for tenant isolation. Adding condominiumId
-- lets pet queries filter by tenant directly, regardless of call ordering.

-- 1. Add the column as nullable so existing rows can be backfilled first.
ALTER TABLE "pets" ADD COLUMN "condominiumId" TEXT;

-- 2. Backfill condominiumId from each pet's owning resident.
UPDATE "pets" AS p
SET "condominiumId" = r."condominiumId"
FROM "residents" AS r
WHERE r."id" = p."residentId";

-- 3. Enforce NOT NULL now that every row carries a value.
ALTER TABLE "pets" ALTER COLUMN "condominiumId" SET NOT NULL;

-- 4. Foreign key to condominiums, matching the Vehicle relation.
ALTER TABLE "pets" ADD CONSTRAINT "pets_condominiumId_fkey" FOREIGN KEY ("condominiumId") REFERENCES "condominiums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Index for tenant-scoped pet queries.
CREATE INDEX "pets_condominiumId_idx" ON "pets"("condominiumId");
