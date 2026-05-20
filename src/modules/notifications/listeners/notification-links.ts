import { NotificationType } from '@prisma/client';

/**
 * Deep-link builders and i18n-key derivation shared by the Phase 3
 * notification listeners.
 *
 * Route conventions follow the web app's `[locale]/(app)/condominiums/
 * [condominiumSlug]/...` tree. As of Phase 3 only the `/dashboard` route is
 * built; the import/calendar/settings targets below are forward-looking —
 * `linkUrl` is inert stored data until Phase 4 wires navigation. See
 * OQ-NT-17 in the Notifications known-issues document. The locale segment is
 * intentionally omitted: next-intl's `as-needed` prefix resolves it at
 * navigation time.
 */

function base(slug: string): string {
  return `/condominiums/${slug}`;
}

export function importsLink(slug: string): string {
  return `${base(slug)}/imports`;
}

export function importBatchLink(slug: string, batchId: string): string {
  return `${base(slug)}/imports/${batchId}`;
}

export function reconciliationRulesLink(slug: string): string {
  return `${base(slug)}/settings/reconciliation-rules`;
}

export function calendarLink(slug: string): string {
  return `${base(slug)}/calendar`;
}

export function calendarEventLink(slug: string, eventId: string): string {
  return `${base(slug)}/calendar/${eventId}`;
}

export function usersLink(slug: string): string {
  return `${base(slug)}/settings/users`;
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
