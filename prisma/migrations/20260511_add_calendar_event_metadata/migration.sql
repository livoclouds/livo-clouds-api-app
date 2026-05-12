-- AlterTable: add nullable metadata column to calendar_events
-- Stores event-type-specific data (e.g. TerraceBookingMetadata for TERRACE_BOOKING).
-- Null for existing rows; no backfill needed.
ALTER TABLE "calendar_events" ADD COLUMN "metadata" JSONB;
