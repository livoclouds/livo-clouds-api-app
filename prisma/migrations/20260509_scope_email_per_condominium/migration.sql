-- Scope email uniqueness per condominium instead of globally.
-- ROOT users (condominiumId IS NULL) retain app-level email uniqueness via service layer.
-- PostgreSQL treats NULL as distinct in unique constraints, so the compound unique
-- on (condominiumId, email) does not enforce uniqueness between root users at DB level.

-- Drop the global unique constraint on email
DROP INDEX IF EXISTS "users_email_key";

-- Add per-condominium unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "users_condominiumId_email_key" ON "users"("condominiumId", "email");
