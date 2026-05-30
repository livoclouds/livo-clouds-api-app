-- RBAC Phase 3: per-user permission overrides.
-- NULL = inherit the assigned role's permissions; a JSON array of catalog keys =
-- the explicit effective permission set for this user. Additive + nullable, so
-- existing users keep inheriting their role (no backfill required).
ALTER TABLE "users" ADD COLUMN "permissionOverrides" JSONB;
