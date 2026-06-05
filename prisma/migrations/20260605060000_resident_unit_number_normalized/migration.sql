-- Case-insensitive unit numbers: "A1" and "a1" are the same unit within a
-- condominium. `unitNumber` keeps the original casing for display; uniqueness
-- moves to a canonical (trimmed, lower-cased) `unitNumberNormalized`.

-- 1. Add the column nullable so the backfill can populate existing rows.
ALTER TABLE "residents" ADD COLUMN "unitNumberNormalized" TEXT;

-- 2. Backfill from the existing unit numbers.
UPDATE "residents" SET "unitNumberNormalized" = lower(btrim("unitNumber"));

-- 3. Create the new unique index BEFORE dropping the old one, so a pre-existing
--    case-collision (e.g. "A1" + "a1" in the same condo) fails here with the old
--    constraint still intact rather than leaving the table unprotected.
CREATE UNIQUE INDEX "residents_condominiumId_unitNumberNormalized_key" ON "residents"("condominiumId", "unitNumberNormalized");

-- 4. Enforce NOT NULL now that every row is populated.
ALTER TABLE "residents" ALTER COLUMN "unitNumberNormalized" SET NOT NULL;

-- 5. Drop the old case-sensitive unique index.
DROP INDEX "residents_condominiumId_unitNumber_key";
