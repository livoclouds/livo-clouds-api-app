/**
 * Domain event emitted by `ReconciliationRulesService` when a reconciliation
 * rule is created, meaningfully updated, or deactivated. Consumed by the
 * Notifications module's `ReconciliationNotificationsListener` (Phase 3).
 */

export const RECONCILIATION_RULE_MODIFIED_EVENT = 'reconciliation.rule_modified';

export type ReconciliationRuleAction = 'created' | 'updated' | 'deactivated';

export interface ReconciliationRuleModifiedEventPayload {
  condominiumId: string;
  ruleId: string;
  ruleName: string;
  action: ReconciliationRuleAction;
  /** User who modified the rule, when the controller supplied it. */
  actorUserId?: string;
}
