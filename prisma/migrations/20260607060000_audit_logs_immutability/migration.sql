-- Phase 5 audit hardening (RP-010): add database-level immutability to audit_logs.
-- The application layer already only ever calls AuditService.log() (append-only),
-- but without a database constraint a privileged DBA could silently modify or delete
-- rows. This trigger makes immutability structural, not just conventional.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutations()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs rows are immutable and cannot be modified or deleted';
END;
$$;

CREATE TRIGGER audit_logs_immutable_guard
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutations();
