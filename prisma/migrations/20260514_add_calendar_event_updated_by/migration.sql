-- Add row-level last-editor attribution to calendar_events
ALTER TABLE "calendar_events" ADD COLUMN "updatedById" TEXT;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
