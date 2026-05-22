-- Drop the legacy condominium-level notification toggles (System A). These five
-- columns were never read by any service, listener, or business logic — the
-- per-user UserNotificationPreference rows are the source of truth for who
-- receives a notification. The Settings notifications tab that wrote them has
-- been removed; NEGATIVE_BALANCE and NEW_INCIDENT now live as per-user
-- preferences alongside the other notification types.

-- AlterTable
ALTER TABLE "condominium_settings" DROP COLUMN "notifyNegativeBalance",
DROP COLUMN "notifyNewFileImported",
DROP COLUMN "notifyImportError",
DROP COLUMN "notifyNewUser",
DROP COLUMN "notifyNewIncident";
