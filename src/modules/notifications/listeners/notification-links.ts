import { NotificationType } from '@prisma/client';

/**
 * Canonical, client-agnostic deep-link references for notifications.
 *
 * These are SEMANTIC pointers to the target resource, NOT literal web routes.
 * Each client (the web app today, a future mobile app or email digest) maps a
 * notification's `type` + `data` to its own concrete route — the web app, for
 * example, resolves `type`+`data` to `/imports?tab=imports&batch=<id>` and does
 * not navigate by these strings. They are kept for audit and non-web consumers.
 *
 * The tenant is intentionally absent: tenant scope comes from the authenticated
 * session, never the URL (CLAUDE.md golden rule #3). The locale is absent too —
 * each client resolves it from its own preference.
 */

export function importsLink(): string {
  return '/imports';
}

export function importBatchLink(batchId: string): string {
  return `/imports/${batchId}`;
}

export function reconciliationRulesLink(): string {
  return '/settings/reconciliation-rules';
}

export function calendarLink(): string {
  return '/calendar';
}

export function calendarEventLink(eventId: string): string {
  return `/calendar/${eventId}`;
}

export function usersLink(): string {
  return '/settings/users';
}

/**
 * The i18n keys stored in a notification's `title` / `message` columns. The
 * web layer (Phase 7) resolves them against the `notifications` namespace;
 * the API never stores translated strings (CLAUDE.md §4, data-model.md).
 */
export function copyKeys(type: NotificationType): {
  title: string;
  message: string;
} {
  return {
    title: `notifications.types.${type}.title`,
    message: `notifications.types.${type}.body`,
  };
}
