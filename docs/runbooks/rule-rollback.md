# Runbook — Rolling back reconciliation-rule changes

Rule mutations queue as **pending changes** until an admin reapplies them, so
most rollbacks are a matter of discarding the right queue entries.

Base path: `condominiums/:slug/settings/reconciliation-rules`
(permission: `paymentRules.manage` for every mutating call).

## Inspect the queue

```
GET …/pending-changes
```

Lists every rule change not yet reapplied to pending transactions, plus the
count of transactions that a reapply would touch.

## Rollback options

| Situation | Call | Effect |
| --- | --- | --- |
| Discard ONE queued change | `POST …/changes/:changeId/discard` | Reverts the rule to its pre-mutation state (recreates for DELETED, deletes for CREATED, restores fields for UPDATED/TOGGLED) and **cascades** to later unapplied entries for the same rule. |
| Accept ONE queued change without reclassifying | `POST …/changes/:changeId/accept` | Marks it applied; no transaction is touched. |
| Discard ALL unapplied toggles | `POST …/discard-pending` | Restores every rule flipped by unapplied TOGGLED entries. |
| Apply everything queued | `POST …/apply-pending` | Reapplies active rules to every `NEEDS_REVIEW`+`PENDING` transaction and marks all queued changes applied. |

## If the bad rule already ran (apply-pending or a new import)

Discarding the change only fixes the **rule**; rows it classified keep their
links. After the rollback:

1. `POST …/apply-pending` again — re-evaluates the still-pending rows under
   the restored rules.
2. Rows the bad rule moved to AUTO need either a per-batch re-run
   (`POST condominiums/:slug/imports/:batchId/classify` — see
   [mass-misclassification.md](mass-misclassification.md)) or manual fixes.

## Ordering

`POST …/reorder` (body: every rule id exactly once) — priority order matters:
first matching rule wins.
