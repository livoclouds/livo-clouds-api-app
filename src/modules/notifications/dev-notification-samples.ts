import { NotificationType, Prisma } from '@prisma/client';
import {
  calendarEventLink,
  calendarLink,
  copyKeys,
  importBatchLink,
  reconciliationRulesLink,
  usersLink,
} from './listeners/notification-links';
import type { R1NotificationType } from './notification-role-matrix';

/**
 * A single dev sample: the same `{ title, message, data, linkUrl }` quadruple a
 * real domain listener would hand to `dispatchEvent`, so the Notification
 * Playground renders byte-for-byte what production produces.
 */
export interface DevNotificationSample {
  title: string;
  message: string;
  data: Prisma.InputJsonValue;
  linkUrl: string | null;
}

// Stable placeholder ids — the playground writes inert rows, so these never
// need to resolve to real records.
const SAMPLE_BATCH_ID = 'dev-batch-0001';
const SAMPLE_EVENT_ID = 'dev-event-0001';

/**
 * Builds a representative notification payload for every role-matrix
 * (`R1`) notification type, reusing the production i18n `copyKeys` and
 * deep-link builders so the `data` shape matches each type's message
 * placeholders (see the web `notifications` i18n namespace). `slug` is the
 * active condominium slug used to build `linkUrl`; pass `null` to omit links.
 * `now` anchors the relative sample dates so callers stay deterministic.
 */
export function buildDevNotificationSample(
  type: R1NotificationType,
  slug: string | null,
  now: Date,
): DevNotificationSample {
  const keys = copyKeys(type);
  const startsAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data, linkUrl } = buildDataAndLink(type, slug, startsAt);
  return { ...keys, data, linkUrl };
}

function buildDataAndLink(
  type: R1NotificationType,
  slug: string | null,
  startsAt: string,
): { data: Prisma.InputJsonValue; linkUrl: string | null } {
  const batchLink = slug ? importBatchLink(slug, SAMPLE_BATCH_ID) : null;
  switch (type) {
    case NotificationType.IMPORT_COMPLETED:
      return {
        data: { batchId: SAMPLE_BATCH_ID, rowCount: 42, currency: 'MXN' },
        linkUrl: batchLink,
      };
    case NotificationType.IMPORT_FAILED:
      return {
        data: { batchId: SAMPLE_BATCH_ID, stage: 'parsing', errorCode: 'E_PARSE' },
        linkUrl: batchLink,
      };
    case NotificationType.IMPORT_WITH_WARNINGS:
      return {
        data: { batchId: SAMPLE_BATCH_ID, warningCount: 3 },
        linkUrl: batchLink,
      };
    case NotificationType.IMPORT_DUPLICATE:
      return {
        data: {
          originalBatchId: SAMPLE_BATCH_ID,
          attemptedFileName: 'estado-cuenta-mayo.xlsx',
        },
        linkUrl: batchLink,
      };
    case NotificationType.CLASSIFICATION_REVIEW:
      return {
        data: { batchId: SAMPLE_BATCH_ID, transactionCount: 7 },
        linkUrl: batchLink,
      };
    case NotificationType.RECONCILIATION_RULE_MODIFIED:
      return {
        data: {
          ruleId: 'dev-rule-0001',
          ruleName: 'Cuotas de mantenimiento',
          action: 'updated',
        },
        linkUrl: slug ? reconciliationRulesLink(slug) : null,
      };
    case NotificationType.CALENDAR_EVENT_CREATED:
      return {
        data: { eventId: SAMPLE_EVENT_ID, title: 'Junta de vecinos', startsAt },
        linkUrl: slug ? calendarEventLink(slug, SAMPLE_EVENT_ID) : null,
      };
    case NotificationType.CALENDAR_EVENT_CANCELLED:
      return {
        data: { eventId: SAMPLE_EVENT_ID, title: 'Junta de vecinos' },
        linkUrl: slug ? calendarLink(slug) : null,
      };
    case NotificationType.CALENDAR_BOOKING_CONFIRMED:
      return {
        data: {
          eventId: SAMPLE_EVENT_ID,
          terraceId: 'dev-terrace-0001',
          residentId: 'dev-resident-0001',
          startsAt,
        },
        linkUrl: slug ? calendarEventLink(slug, SAMPLE_EVENT_ID) : null,
      };
    case NotificationType.NEGATIVE_BALANCE:
      return { data: {}, linkUrl: null };
    case NotificationType.NEW_INCIDENT:
      return { data: {}, linkUrl: null };
    case NotificationType.USER_ADDED:
      return {
        data: {
          userId: 'dev-user-0001',
          email: 'nuevo@cotoalameda.com',
          role: 'READ_ONLY',
        },
        linkUrl: slug ? usersLink(slug) : null,
      };
    case NotificationType.PERMISSIONS_CHANGED:
      return {
        data: {
          userId: 'dev-user-0001',
          beforeRole: 'READ_ONLY',
          afterRole: 'TENANT_ADMIN',
        },
        linkUrl: slug ? usersLink(slug) : null,
      };
    case NotificationType.SESSION_EXPIRING:
      return { data: { minutesRemaining: 5 }, linkUrl: null };
    default: {
      // Exhaustiveness guard — a new R1 type widens the union and breaks the
      // build here until a sample is added above.
      return assertNever(type);
    }
  }
}

function assertNever(type: never): never {
  throw new Error(`Unhandled dev notification sample type: ${String(type)}`);
}
