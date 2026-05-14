-- Add recurrence support to calendar_events (Phase 5A).
-- recurrenceRule stores an RFC 5545 RRULE string; null = single-occurrence event.
-- parentEventId is a self-referencing FK reserved for future per-occurrence
-- exceptions (Phase 5A introduces the column but no service code reads or
-- writes it yet — see docs/modules/calendar/data-model.md).
ALTER TABLE "calendar_events" ADD COLUMN "recurrenceRule" TEXT;
ALTER TABLE "calendar_events" ADD COLUMN "parentEventId" TEXT;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_parentEventId_idx" ON "calendar_events"("condominiumId", "parentEventId");
