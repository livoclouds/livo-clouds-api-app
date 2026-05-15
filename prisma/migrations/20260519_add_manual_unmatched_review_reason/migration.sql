-- Add MANUAL_UNMATCHED to RequiresReviewReason (Phase 4, REV-016).
-- Distinguishes admin-driven unmatch actions from engine-driven NO_MATCH,
-- so reports/metrics no longer conflate "engine could not match" with
-- "admin intentionally moved a transaction back to review."
-- Additive: existing rows keep their current reason value untouched.
ALTER TYPE "RequiresReviewReason" ADD VALUE 'MANUAL_UNMATCHED';
