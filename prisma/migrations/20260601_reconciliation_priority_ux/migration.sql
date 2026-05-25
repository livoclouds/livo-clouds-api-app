-- Reconciliation rules priority UX overhaul.
--
-- 1. Adds REORDERED to the RuleChangeAction enum so reorder operations land
--    in the change log next to CREATED/UPDATED/DELETED/TOGGLED — reordering
--    can change which rule wins the first-match loop during classification,
--    so it must trigger the "rules modified since last reapply" banner.
--
-- 2. Resequences the priority of every existing reconciliation rule to a
--    consecutive 1..N range per condominium, ordered by the previous
--    (priority, createdAt) tuple. The number the user sees is now the
--    same as the value stored in DB — no more "huecos" from the old
--    seed convention (0, 5, 10, 15, 20, 25…).

-- 1) Extend the enum.
ALTER TYPE "RuleChangeAction" ADD VALUE IF NOT EXISTS 'REORDERED';

-- 2) Resequence priorities to 1..N per condominium.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "condominiumId"
      ORDER BY priority ASC, "createdAt" ASC
    ) AS new_priority
  FROM "reconciliation_rules"
)
UPDATE "reconciliation_rules" r
SET priority = ranked.new_priority
FROM ranked
WHERE r.id = ranked.id;
