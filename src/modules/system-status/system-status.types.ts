/**
 * System Status — public response contract.
 *
 * Consumed by the web app's ROOT-only "System Status" page. Every value here is
 * derived from real signals (DB reachability + AuditLog activity + per-module
 * enrichment); nothing is simulated. The `technical` block exists so technical
 * users can see exactly which source was queried, what came back, and which rule
 * produced the status.
 */

export type ModuleHealthStatus = 'operational' | 'degraded' | 'outage';

export type ModuleCategory =
  | 'financial'
  | 'residents'
  | 'operations'
  | 'communications'
  | 'platform';

export interface ModuleTechnicalDetail {
  /** Human-readable description of the source(s) queried for this module. */
  source: string;
  /** Raw signal summary received from those source(s). */
  response: Record<string, unknown>;
  /** The exact rule that produced the reported status (includes the numbers). */
  determination: string;
}

export interface ModuleHealth {
  key: string;
  category: ModuleCategory;
  status: ModuleHealthStatus;
  /** When this module's signals were last evaluated (ISO 8601). */
  checkedAt: string;
  /** Last successful activity/update observed for this module (ISO 8601 | null). */
  lastValidUpdateAt: string | null;
  /** Round-trip latency of the DB connectivity probe backing this check, in ms. */
  latencyMs: number;
  technical: ModuleTechnicalDetail;
  recentIncident: {
    at: string | null;
    summary: string | null;
  };
}

export interface SystemStatusSnapshot {
  /** When this snapshot was computed (ISO 8601). Stable across cache hits. */
  generatedAt: string;
  /** TTL of the server-side cache that produced this snapshot, in seconds. */
  cacheTtlSeconds: number;
  /** Round-trip latency of the DB connectivity probe, in ms. */
  dbLatencyMs: number;
  overall: ModuleHealthStatus;
  counts: {
    total: number;
    operational: number;
    degraded: number;
    outage: number;
  };
  modules: ModuleHealth[];
}
