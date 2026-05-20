/**
 * Domain events emitted by `ImportsService` once an import outcome is final.
 * Consumed by the Notifications module's `ImportsNotificationsListener`
 * (Phase 3). The imports module itself has no knowledge of notifications —
 * these are plain domain events.
 */

export const IMPORT_COMPLETED_EVENT = 'import.completed';
export const IMPORT_FAILED_EVENT = 'import.failed';
export const IMPORT_WARNING_EVENT = 'import.warning';
export const IMPORT_DUPLICATE_EVENT = 'import.duplicate';

export interface ImportCompletedEventPayload {
  condominiumId: string;
  batchId: string;
  rowCount: number;
  currency: string;
  /** User who initiated the import; excluded from the recipient set. */
  actorUserId: string;
}

export interface ImportFailedEventPayload {
  condominiumId: string;
  batchId: string;
  /** Pipeline stage that failed, e.g. `VALIDATE` or `CLASSIFY`. */
  stage: string;
  errorCode: string;
  actorUserId: string;
}

export interface ImportWarningEventPayload {
  condominiumId: string;
  batchId: string;
  warningCount: number;
  actorUserId: string;
}

export interface ImportDuplicateEventPayload {
  condominiumId: string;
  /** Batch of the original (already imported) file. */
  originalBatchId: string;
  attemptedFileName: string;
  actorUserId: string;
}
