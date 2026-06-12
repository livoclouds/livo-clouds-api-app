-- ENGINE-021: unitNumberDetected (scalar) and unitNumbersDetected (array) must
-- move together. Legal states:
--   (scalar NULL, any array)                       — multi-unit split or no detection
--   (scalar set, array = '{}')                     — legacy single-unit rows
--   (scalar set, array = ARRAY[scalar])            — single-unit detection
-- A single-unit link keeping a stale multi-unit array reads as a split payment
-- downstream and corrupts balance/attribution math.

-- Clean desynced rows first or the constraint fails to apply: a row whose
-- scalar is set but whose array disagrees collapses to the scalar's unit.
UPDATE "transactions"
SET "unitNumbersDetected" = ARRAY["unitNumberDetected"]
WHERE "unitNumberDetected" IS NOT NULL
  AND "unitNumbersDetected" <> '{}'
  AND "unitNumbersDetected" <> ARRAY["unitNumberDetected"];

ALTER TABLE "transactions"
ADD CONSTRAINT "transactions_unit_detection_sync_check"
CHECK (
  "unitNumberDetected" IS NULL
  OR "unitNumbersDetected" = '{}'
  OR "unitNumbersDetected" = ARRAY["unitNumberDetected"]
);
