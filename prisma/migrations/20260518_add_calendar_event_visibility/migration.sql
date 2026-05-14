-- Add event-level visibility scope to calendar_events (Phase 5C).
-- Existing rows default to PUBLIC, preserving pre-5C behavior where every
-- authenticated calendar viewer in the condominium can see every non-deleted
-- event. Admins can later restrict an event to COUNCIL_ONLY (root +
-- tenant_admin + read_only) or PRIVATE (root + tenant_admin + creator).
CREATE TYPE "CalendarEventVisibility" AS ENUM ('PUBLIC', 'COUNCIL_ONLY', 'PRIVATE');

ALTER TABLE "calendar_events"
  ADD COLUMN "visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'PUBLIC';
