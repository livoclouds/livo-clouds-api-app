-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "recurrenceEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "calendar_events_condominiumId_recurrenceEndsAt_idx" ON "calendar_events"("condominiumId", "recurrenceEndsAt");
