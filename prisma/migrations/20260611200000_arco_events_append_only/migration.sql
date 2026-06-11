-- Phase 7b (RP-011): tamper-evidence for the ARCO request timeline.
-- arco_request_events is an append-only audit trail. The application layer only
-- ever inserts events, but without a database constraint a privileged DBA could
-- silently rewrite the history a regulator relies on. This trigger makes the
-- timeline structurally immutable:
--   * UPDATE is ALWAYS blocked — a recorded event can never be altered.
--   * DELETE is blocked too, EXCEPT inside an authorized retention purge, which
--     the ArcoRetentionService signals by setting the transaction-local flag
--     `arco.purge = 'on'` before cascade-deleting resolved requests (RP-005).
--     Any other deletion (manual, ad-hoc) is refused.
-- This keeps the append-only guarantee while still allowing the documented,
-- audited data-minimization erasure.

CREATE OR REPLACE FUNCTION prevent_arco_event_mutations()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'arco_request_events rows are immutable and cannot be modified';
  END IF;
  -- TG_OP = 'DELETE'
  IF current_setting('arco.purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'arco_request_events rows are append-only; deletion is only permitted via the audited retention purge';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER arco_request_events_immutable_guard
BEFORE UPDATE OR DELETE ON "arco_request_events"
FOR EACH ROW EXECUTE FUNCTION prevent_arco_event_mutations();
