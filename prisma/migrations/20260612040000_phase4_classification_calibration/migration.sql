-- Financial Engine audit Phase 4 — classification precision & calibration.
--
-- ENGINE-045: dedicated review reason for multi-unit payments.
-- ENGINE-043: dedicated match source for re-applied manual corrections.
-- ENGINE-009: bank dialect promoted to a validated BankProfile field
--             (backfilled once from the bankName substring heuristic; the
--             engine reads ONLY the column from now on).
-- ENGINE-042: per-pattern attribution on Transaction so override rates can be
--             sliced by extraction pattern (calibration prerequisite).
--
-- PG note: ALTER TYPE ... ADD VALUE is allowed inside this transaction because
-- neither new value is used later in the same transaction; the backfill below
-- only uses values of the freshly created "BankDialect" type, which is fine.

ALTER TYPE "RequiresReviewReason" ADD VALUE 'MULTI_UNIT_SPLIT_REQUIRED';
ALTER TYPE "MatchSource" ADD VALUE 'CORRECTION_PATTERN';

CREATE TYPE "BankDialect" AS ENUM ('GENERIC', 'BANBAJIO');

ALTER TABLE "bank_profiles"
  ADD COLUMN "dialect" "BankDialect" NOT NULL DEFAULT 'GENERIC';

-- One-time backfill mirroring known-banks.ts isBanBajio() (normalized substring
-- "bajio"). A profile renamed after this migration keeps its dialect — that is
-- the point of ENGINE-009.
UPDATE "bank_profiles"
   SET "dialect" = 'BANBAJIO'
 WHERE "bankName" ILIKE '%bajio%'
    OR "bankName" ILIKE '%bajío%';

ALTER TABLE "transactions"
  ADD COLUMN "matchedPatternLabel" TEXT;
