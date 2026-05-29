import { ModuleHealthStatus } from './system-status.types';

/**
 * Pure status-determination rules — no I/O, fully unit-testable.
 *
 * Thresholds are intentionally conservative and centralised here so they can be
 * tuned in one place. Every verdict carries a `determination` string that spells
 * out the exact numbers behind the status, so technical users can audit it.
 */

export const ERROR_WINDOW_MINUTES = 60;
export const DEGRADED_ERROR_THRESHOLD = 1; // >= 1 audit ERROR in window ⇒ degraded
export const OUTAGE_ERROR_THRESHOLD = 20; // >= 20 audit ERRORs in window ⇒ outage
export const IMPORTS_FAILED_DEGRADED = 1; // >= 1 failed batch in 24h ⇒ degraded
export const IMPORTS_FAILED_OUTAGE = 10; // >= 10 failed batches in 24h ⇒ outage

export interface ModuleSignal {
  dbReachable: boolean;
  hasAuditSignal: boolean;
  errorsInWindow: number;
  /** Only present for the `imports` module. */
  importsFailed24h?: number;
  /** Only present for the `whatsapp` module. */
  whatsappErrorCount?: number;
}

export interface StatusVerdict {
  status: ModuleHealthStatus;
  determination: string;
}

export function determineModuleStatus(signal: ModuleSignal): StatusVerdict {
  if (!signal.dbReachable) {
    return {
      status: 'outage',
      determination: 'Database connectivity probe (SELECT 1) failed ⇒ outage.',
    };
  }

  // Imports: a high volume of failed batches escalates straight to outage.
  if (
    signal.importsFailed24h !== undefined &&
    signal.importsFailed24h >= IMPORTS_FAILED_OUTAGE
  ) {
    return {
      status: 'outage',
      determination: `${signal.importsFailed24h} failed import batches in the last 24h (>= ${IMPORTS_FAILED_OUTAGE}) ⇒ outage.`,
    };
  }

  if (signal.errorsInWindow >= OUTAGE_ERROR_THRESHOLD) {
    return {
      status: 'outage',
      determination: `${signal.errorsInWindow} audit errors in the last ${ERROR_WINDOW_MINUTES}m (>= ${OUTAGE_ERROR_THRESHOLD}) ⇒ outage.`,
    };
  }

  if (signal.errorsInWindow >= DEGRADED_ERROR_THRESHOLD) {
    return {
      status: 'degraded',
      determination: `${signal.errorsInWindow} audit error(s) in the last ${ERROR_WINDOW_MINUTES}m (>= ${DEGRADED_ERROR_THRESHOLD}) ⇒ degraded.`,
    };
  }

  if (
    signal.importsFailed24h !== undefined &&
    signal.importsFailed24h >= IMPORTS_FAILED_DEGRADED
  ) {
    return {
      status: 'degraded',
      determination: `${signal.importsFailed24h} failed import batch(es) in the last 24h (>= ${IMPORTS_FAILED_DEGRADED}) ⇒ degraded.`,
    };
  }

  if (
    signal.whatsappErrorCount !== undefined &&
    signal.whatsappErrorCount > 0
  ) {
    return {
      status: 'degraded',
      determination: `${signal.whatsappErrorCount} WhatsApp credential(s) in ERROR state ⇒ degraded.`,
    };
  }

  if (!signal.hasAuditSignal) {
    return {
      status: 'operational',
      determination:
        'Database reachable; this module emits no audit signal ⇒ operational (connectivity-only).',
    };
  }

  return {
    status: 'operational',
    determination: `No audit errors in the last ${ERROR_WINDOW_MINUTES}m and database reachable ⇒ operational.`,
  };
}

/** Roll module statuses up into a single overall status (worst wins). */
export function rollUpOverall(
  statuses: ModuleHealthStatus[],
): ModuleHealthStatus {
  if (statuses.some((s) => s === 'outage')) return 'outage';
  if (statuses.some((s) => s === 'degraded')) return 'degraded';
  return 'operational';
}
