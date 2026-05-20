/**
 * Domain event emitted by `ClassificationService` when a classified batch
 * leaves transactions that require manual review. Consumed by the
 * Notifications module's `ClassificationNotificationsListener` (Phase 3).
 */

export const CLASSIFICATION_REVIEW_NEEDED_EVENT = 'classification.review_needed';

export interface ClassificationReviewNeededEventPayload {
  condominiumId: string;
  batchId: string;
  /** Count of transactions left in NEEDS_REVIEW state. */
  transactionCount: number;
  /**
   * User who triggered the classification run, when known. Classification
   * also runs from non-interactive paths, so this may be absent.
   */
  actorUserId?: string;
}
