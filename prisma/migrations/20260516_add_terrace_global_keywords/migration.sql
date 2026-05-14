-- Add tenant-level global terrace keywords to condominium_settings (Phase 5F / KI-004)
ALTER TABLE "condominium_settings"
  ADD COLUMN "terraceGlobalKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
