-- Add AUTO_TERRACE_BOOKING to MatchSource enum
ALTER TYPE "MatchSource" ADD VALUE 'AUTO_TERRACE_BOOKING';

-- Add TERRACE_AMBIGUOUS to RequiresReviewReason enum
ALTER TYPE "RequiresReviewReason" ADD VALUE 'TERRACE_AMBIGUOUS';

-- Add matchedCalendarEventId to transactions
ALTER TABLE "transactions" ADD COLUMN "matchedCalendarEventId" TEXT;

-- Add foreign key constraint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_matchedCalendarEventId_fkey"
  FOREIGN KEY ("matchedCalendarEventId") REFERENCES "calendar_events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index for the new FK column
CREATE INDEX "transactions_matchedCalendarEventId_idx" ON "transactions"("matchedCalendarEventId");
