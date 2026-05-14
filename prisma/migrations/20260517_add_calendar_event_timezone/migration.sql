-- Add optional per-event IANA timezone override to calendar_events (Phase 5B).
-- When set, list/detail rendering uses this timezone instead of CondominiumSettings.timezone.
-- NULL preserves the existing behavior (event renders in the condominium timezone).
ALTER TABLE "calendar_events" ADD COLUMN "timezone" TEXT;
