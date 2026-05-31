-- Rename system roles: ROOT display, READ_ONLY label, NEIGHBOR key → RESIDENT
-- Data-only migration: the roles table uses String keys, no schema change needed.

UPDATE "roles" SET "name" = 'Root'
  WHERE "key" = 'ROOT';

UPDATE "roles" SET
  "name" = 'Auditor',
  "description" = 'Condominium auditor — read-only access to reports, dashboard, and calendar.'
  WHERE "key" = 'READ_ONLY';

UPDATE "roles" SET
  "key" = 'RESIDENT',
  "name" = 'Resident',
  "description" = 'Unit resident — calendar bookings, notifications, and future interactive features.'
  WHERE "key" = 'NEIGHBOR';
