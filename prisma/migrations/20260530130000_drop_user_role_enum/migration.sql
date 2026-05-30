-- RBAC Phase 2 (final): remove the legacy role enum. The `roles` table + roleId
-- are now the single source of truth (every user is backfilled). Dropping the
-- column also drops its index; then the enum type is removed.
ALTER TABLE "users" DROP COLUMN "role";
DROP TYPE "UserRole";
