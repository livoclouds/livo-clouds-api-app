import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Notification,
  NotificationType,
  Prisma,
  RootScope,
} from '@prisma/client';
import { UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AGGREGATION_WINDOW_MINUTES,
  NOTIFICATION_R1_TYPES,
} from './notifications.constants';
import { NotificationsSseGateway } from './notifications.gateway';
import { WebPushService } from '../web-push/web-push.service';
import {
  isR1NotificationType,
  NOTIFICATION_ROLE_ACCESS,
} from './notification-role-matrix';
import type {
  NotificationSortDirection,
  NotificationSortField,
} from './dto/list-notifications.dto';

export interface ListNotificationsParams {
  userId: string;
  /** Tenant-scoped listing. Omit for the ROOT cross-tenant `/me` inbox. */
  condominiumId?: string;
  page: number;
  limit: number;
  unreadOnly?: boolean;
  /** Return only notifications that have already been read. */
  readOnly?: boolean;
  includeDismissed?: boolean;
  /** Return only currently-snoozed notifications (for the "Snoozed" view). */
  snoozedOnly?: boolean;
  /** Include snoozed-and-not-yet-due notifications alongside the rest. */
  includeSnoozed?: boolean;
  types?: NotificationType[];
  from?: string;
  to?: string;
  /** Sort field; defaults to `createdAt`. */
  sortBy?: NotificationSortField;
  /** Sort direction; defaults to `desc`. */
  sortDir?: NotificationSortDirection;
}

export interface NotificationEventInput {
  userId: string;
  condominiumId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
  linkUrl?: string | null;
}

export interface ResolveRecipientsOptions {
  /** Domain payload for the triggering event; used by per-type owner filters. */
  eventData?: Record<string, unknown>;
  /** User who performed the action; excluded from the recipient set. */
  actorUserId?: string;
}

/**
 * Input for the Phase 3 fan-out path. A domain listener supplies the
 * translated notification once; `dispatchEvent` resolves the recipient set and
 * writes one notification per recipient.
 */
export interface DispatchEventInput {
  type: NotificationType;
  condominiumId: string;
  /** i18n key (e.g. `notifications.types.IMPORT_COMPLETED.title`). */
  title: string;
  /** i18n key (e.g. `notifications.types.IMPORT_COMPLETED.body`). */
  message: string;
  data?: Prisma.InputJsonValue;
  linkUrl?: string | null;
  /** Actor of the domain action; excluded from the recipient set. */
  actorUserId?: string;
}

/** Reads a non-empty string field from an untyped event payload. */
function readStringField(
  data: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * A notification is hidden by snooze while `snoozedUntil` is in the future. This
 * predicate selects rows that are NOT currently snoozed (never snoozed, or the
 * snooze has elapsed) — when the snooze passes, the row resurfaces naturally on
 * the next query/sync. Spliced into every default-view query so snoozed rows
 * drop out of the inbox, the unread count and the SSE snapshot until due.
 */
function notVisiblySnoozed(
  now: Date,
): Prisma.NotificationWhereInput {
  return {
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsSseGateway,
    private webPush: WebPushService,
  ) {}

  async list(params: ListNotificationsParams) {
    const { userId, condominiumId, page, limit } = params;

    const where: Prisma.NotificationWhereInput = { userId };
    if (condominiumId) {
      where.condominiumId = condominiumId;
    }
    if (params.unreadOnly) {
      where.readAt = null;
    } else if (params.readOnly) {
      where.readAt = { not: null };
    }
    if (!params.includeDismissed) {
      where.dismissedAt = null;
    }
    const now = new Date();
    if (params.snoozedOnly) {
      // The dedicated "Snoozed" view: only rows still hidden by a future snooze.
      where.snoozedUntil = { gt: now };
    } else if (!params.includeSnoozed) {
      // Default views hide snoozed-and-not-yet-due rows.
      where.AND = [notVisiblySnoozed(now)];
    }
    if (params.types && params.types.length > 0) {
      where.type = { in: params.types };
    }
    if (params.from || params.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (params.from) {
        createdAt.gte = new Date(params.from);
      }
      if (params.to) {
        createdAt.lte = new Date(params.to);
      }
      where.createdAt = createdAt;
    }

    const unreadWhere: Prisma.NotificationWhereInput = {
      userId,
      readAt: null,
      dismissedAt: null,
      // The badge count never includes snoozed-and-hidden rows.
      AND: [notVisiblySnoozed(now)],
    };
    if (condominiumId) {
      unreadWhere.condominiumId = condominiumId;
    }

    const orderBy: Prisma.NotificationOrderByWithRelationInput = {
      [params.sortBy ?? 'createdAt']: params.sortDir ?? 'desc',
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: unreadWhere }),
    ]);

    return { items, page, limit, total, unreadCount };
  }

  async getUnreadCount(condominiumId: string, userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: {
        condominiumId,
        userId,
        readAt: null,
        dismissedAt: null,
        AND: [notVisiblySnoozed(new Date())],
      },
    });
    return { unreadCount };
  }

  async markRead(condominiumId: string, id: string, userId: string) {
    const notification = await this.findOwnedOrThrow(condominiumId, id, userId);
    if (notification.readAt) {
      return {
        id: notification.id,
        readAt: notification.readAt,
        isRead: true,
      };
    }
    return this.prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date(), isRead: true },
      select: { id: true, readAt: true, isRead: true },
    });
  }

  async markAllRead(condominiumId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { condominiumId, userId, readAt: null },
      data: { readAt: new Date(), isRead: true },
    });
    return { updatedCount: result.count };
  }

  async dismiss(condominiumId: string, id: string, userId: string) {
    const notification = await this.findOwnedOrThrow(condominiumId, id, userId);
    if (notification.dismissedAt) {
      return { id: notification.id, dismissedAt: notification.dismissedAt };
    }
    return this.prisma.notification.update({
      where: { id: notification.id },
      data: { dismissedAt: new Date() },
      select: { id: true, dismissedAt: true },
    });
  }

  /**
   * Snoozes a notification until `snoozedUntil` (an absolute future instant).
   * The row stays unread; it simply disappears from the default views until due,
   * then resurfaces on the next query/sync. Read state is intentionally left
   * untouched so a snoozed-then-due item returns in whatever state it had.
   */
  async snooze(
    condominiumId: string,
    id: string,
    userId: string,
    snoozedUntil: Date,
  ) {
    const notification = await this.findOwnedOrThrow(condominiumId, id, userId);
    if (snoozedUntil.getTime() <= Date.now()) {
      throw new BadRequestException('snoozedUntil must be in the future');
    }
    return this.prisma.notification.update({
      where: { id: notification.id },
      data: { snoozedUntil },
      select: { id: true, snoozedUntil: true },
    });
  }

  /** Clears a snooze so the notification returns to the inbox immediately. */
  async unsnooze(condominiumId: string, id: string, userId: string) {
    const notification = await this.findOwnedOrThrow(condominiumId, id, userId);
    return this.prisma.notification.update({
      where: { id: notification.id },
      data: { snoozedUntil: null },
      select: { id: true, snoozedUntil: true },
    });
  }

  async getPreferences(userId: string, role: string) {
    const userRole = role as UserRole;
    const rows = await this.prisma.userNotificationPreference.findMany({
      where: { userId },
    });
    const overrides = new Map(rows.map((row) => [row.type, row.enabled]));

    // Missing rows default to enabled (opt-out model). Only the r1 types the
    // caller's role may receive are surfaced, so the response mirrors the
    // hide-don't-disable rule the preferences UI applies (OQ-NT-12).
    const preferences: Record<string, boolean> = {};
    for (const type of NOTIFICATION_R1_TYPES) {
      if (
        isR1NotificationType(type) &&
        (NOTIFICATION_ROLE_ACCESS[type] as readonly UserRole[]).includes(
          userRole,
        )
      ) {
        preferences[type] = overrides.get(type) ?? true;
      }
    }
    return { preferences };
  }

  async updatePreferences(
    userId: string,
    role: string,
    input: Record<string, boolean>,
  ) {
    const userRole = role as UserRole;
    // A user may only change preferences for types their role can receive;
    // keys outside that set are silently ignored rather than rejected.
    const allowed = new Set<string>(
      NOTIFICATION_R1_TYPES.filter(
        (type) =>
          isR1NotificationType(type) &&
          (NOTIFICATION_ROLE_ACCESS[type] as readonly UserRole[]).includes(
            userRole,
          ),
      ),
    );
    const entries = Object.entries(input ?? {}).filter(
      ([type, enabled]) => allowed.has(type) && typeof enabled === 'boolean',
    );

    if (entries.length > 0) {
      await this.prisma.$transaction(
        entries.map(([type, enabled]) =>
          this.prisma.userNotificationPreference.upsert({
            where: {
              userId_type: { userId, type: type as NotificationType },
            },
            create: { userId, type: type as NotificationType, enabled },
            update: { enabled },
          }),
        ),
      );
    }

    return this.getPreferences(userId, role);
  }

  async getRootScope(userId: string) {
    const row = await this.prisma.rootNotificationScope.findUnique({
      where: { userId },
    });
    if (!row) {
      return { scope: RootScope.ACTIVE_TENANT, condominiumIds: [] as string[] };
    }
    return { scope: row.scope, condominiumIds: row.condominiumIds };
  }

  async updateRootScope(
    userId: string,
    dto: { scope: RootScope; condominiumIds?: string[] },
  ) {
    const condominiumIds =
      dto.scope === RootScope.SPECIFIC ? (dto.condominiumIds ?? []) : [];

    if (dto.scope === RootScope.SPECIFIC && condominiumIds.length === 0) {
      throw new BadRequestException(
        'condominiumIds must contain at least one id when scope is SPECIFIC',
      );
    }

    const row = await this.prisma.rootNotificationScope.upsert({
      where: { userId },
      create: { userId, scope: dto.scope, condominiumIds },
      update: { scope: dto.scope, condominiumIds },
    });
    return { scope: row.scope, condominiumIds: row.condominiumIds };
  }

  /**
   * Initial payload for an SSE connection: the unread count plus the most
   * recent (non-dismissed) notifications, fetched in a single round trip.
   */
  async getStreamSync(condominiumId: string, userId: string) {
    const now = new Date();
    const [recent, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          userId,
          condominiumId,
          dismissedAt: null,
          AND: [notVisiblySnoozed(now)],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.notification.count({
        where: {
          userId,
          condominiumId,
          readAt: null,
          dismissedAt: null,
          AND: [notVisiblySnoozed(now)],
        },
      }),
    ]);
    return { unreadCount, recent };
  }

  /**
   * Resolves the set of user ids that should receive a notification of `type`
   * for `condominiumId`. Centralizes every recipient rule — the role matrix,
   * ROOT scoping, per-type owner filters, preference opt-outs and actor
   * exclusion — so controllers and (Phase 3) listeners never re-derive them.
   */
  async resolveRecipientsForType(
    type: NotificationType,
    condominiumId: string,
    options: ResolveRecipientsOptions = {},
  ): Promise<string[]> {
    // Legacy types have no role matrix entry and therefore no recipients.
    if (!isR1NotificationType(type)) {
      return [];
    }
    const eligibleRoles = NOTIFICATION_ROLE_ACCESS[type];

    const rows = await this.prisma.user.findMany({
      where: {
        roleRef: { key: { in: eligibleRoles as readonly string[] as string[] } },
        isActive: true,
        deletedAt: null,
        // ROOT users have no condominiumId; they are picked up by role alone.
        OR: [{ condominiumId }, { roleRef: { key: UserRole.ROOT } }],
      },
      select: { id: true, email: true, roleRef: { select: { key: true } } },
    });
    // Flatten roleRef.key back to `role` so the downstream role-based helpers
    // (typed `{ role: UserRole }`) are unchanged after the enum column removal.
    let candidates = rows.map((u) => ({
      id: u.id,
      email: u.email,
      role: (u.roleRef?.key ?? '') as UserRole,
    }));

    candidates = await this.applyRootScope(candidates, condominiumId);
    candidates = await this.applyNeighborOwnerFilter(
      candidates,
      type,
      condominiumId,
      options.eventData,
    );
    candidates = await this.applyPreferenceOptOut(candidates, type);

    // Never notify the actor about their own action.
    const recipientIds = candidates
      .map((u) => u.id)
      .filter((id) => id !== options.actorUserId);
    return Array.from(new Set(recipientIds));
  }

  /**
   * A ROOT user receives a tenant's notification only when their
   * RootNotificationScope opts in. ACTIVE_TENANT cannot be resolved
   * server-side (there is no active-condominium field) and is therefore
   * treated as opt-out — see OQ-NT-14.
   */
  private async applyRootScope<T extends { id: string; role: UserRole }>(
    candidates: T[],
    condominiumId: string,
  ): Promise<T[]> {
    const rootIds = candidates
      .filter((u) => u.role === UserRole.ROOT)
      .map((u) => u.id);
    if (rootIds.length === 0) {
      return candidates;
    }
    const scopes = await this.prisma.rootNotificationScope.findMany({
      where: { userId: { in: rootIds } },
    });
    const scopeByUser = new Map(scopes.map((s) => [s.userId, s]));
    return candidates.filter((u) => {
      if (u.role !== UserRole.ROOT) {
        return true;
      }
      const scope = scopeByUser.get(u.id);
      const mode = scope?.scope ?? RootScope.ACTIVE_TENANT;
      if (mode === RootScope.ALL) {
        return true;
      }
      if (mode === RootScope.SPECIFIC) {
        return (scope?.condominiumIds ?? []).includes(condominiumId);
      }
      return false; // ACTIVE_TENANT — see OQ-NT-14
    });
  }

  /**
   * A booking confirmation reaches a RESIDENT only when the booking's resident
   * unit belongs to that user. The sole User-to-unit bridge available today is
   * a shared email address with the Resident row — see OQ-NT-13. Other roles
   * are unaffected.
   */
  private async applyNeighborOwnerFilter<
    T extends { role: UserRole; email: string },
  >(
    candidates: T[],
    type: NotificationType,
    condominiumId: string,
    eventData: Record<string, unknown> | undefined,
  ): Promise<T[]> {
    if (
      type !== NotificationType.CALENDAR_BOOKING_CONFIRMED ||
      !candidates.some((u) => u.role === UserRole.RESIDENT)
    ) {
      return candidates;
    }
    const ownerEmail = await this.resolveBookingOwnerEmail(
      condominiumId,
      eventData,
    );
    const ownerEmailLower = ownerEmail?.toLowerCase() ?? null;
    return candidates.filter((u) => {
      if (u.role !== UserRole.RESIDENT) {
        return true;
      }
      return (
        ownerEmailLower !== null && u.email.toLowerCase() === ownerEmailLower
      );
    });
  }

  /**
   * A disabled UserNotificationPreference row removes the user; a missing row
   * keeps them (default-on opt-out model).
   */
  private async applyPreferenceOptOut<T extends { id: string }>(
    candidates: T[],
    type: NotificationType,
  ): Promise<T[]> {
    const candidateIds = candidates.map((u) => u.id);
    if (candidateIds.length === 0) {
      return candidates;
    }
    const disabled = await this.prisma.userNotificationPreference.findMany({
      where: { type, enabled: false, userId: { in: candidateIds } },
      select: { userId: true },
    });
    const disabledIds = new Set(disabled.map((p) => p.userId));
    return candidates.filter((u) => !disabledIds.has(u.id));
  }

  /**
   * Looks up the email of the resident who owns a booking, resolving from
   * `residentId` when present and falling back to a unit-number field.
   * Returns null when the resident or their email cannot be determined.
   */
  private async resolveBookingOwnerEmail(
    condominiumId: string,
    eventData: Record<string, unknown> | undefined,
  ): Promise<string | null> {
    const residentId = readStringField(eventData, 'residentId');
    const unitNumber =
      readStringField(eventData, 'residentUnitId') ??
      readStringField(eventData, 'unitNumber');

    let resident: { email: string | null } | null = null;
    if (residentId) {
      resident = await this.prisma.resident.findFirst({
        where: { id: residentId, condominiumId, deletedAt: null },
        select: { email: true },
      });
    } else if (unitNumber) {
      resident = await this.prisma.resident.findFirst({
        where: { condominiumId, unitNumber, deletedAt: null },
        select: { email: true },
      });
    }
    return resident?.email ?? null;
  }

  /**
   * Per-user primitive for domain event listeners. Delegates to the
   * aggregation path so repeated events of the same kind coalesce. Used
   * directly only when the recipient is a single, already-known user
   * (e.g. SESSION_EXPIRING); otherwise listeners go through `dispatchEvent`.
   */
  async createForEvent(input: NotificationEventInput): Promise<Notification> {
    return this.tryAggregate(input);
  }

  /**
   * Fan-out entry point for Phase 3 domain listeners. Resolves the recipient
   * set for `type` from the role matrix (preferences, ROOT scope, RESIDENT
   * owner filter and actor exclusion all applied), then writes one — possibly
   * aggregated — notification per recipient. This wrapper is what the
   * architecture's "centralized recipient resolution" decision refers to:
   * `createForEvent` is the per-user primitive it loops over.
   */
  async dispatchEvent(
    input: DispatchEventInput,
  ): Promise<{ recipientCount: number }> {
    const eventData =
      input.data !== undefined &&
      input.data !== null &&
      typeof input.data === 'object' &&
      !Array.isArray(input.data)
        ? (input.data as Record<string, unknown>)
        : undefined;

    const recipientIds = await this.resolveRecipientsForType(
      input.type,
      input.condominiumId,
      { eventData, actorUserId: input.actorUserId },
    );

    for (const userId of recipientIds) {
      await this.createForEvent({
        userId,
        condominiumId: input.condominiumId,
        type: input.type,
        title: input.title,
        message: input.message,
        data: input.data,
        linkUrl: input.linkUrl,
      });
    }

    return { recipientCount: recipientIds.length };
  }

  /**
   * Resolves a condominium slug from its id. Listeners use it to build the
   * `linkUrl` deep link, which is keyed on the slug-based web route segment.
   */
  async resolveCondominiumSlug(condominiumId: string): Promise<string | null> {
    const row = await this.prisma.condominium.findUnique({
      where: { id: condominiumId },
      select: { slug: true },
    });
    return row?.slug ?? null;
  }

  /**
   * Coalesces an incoming event into an open aggregate row when one exists for
   * the same (userId, type, condominiumId) and its window has not closed,
   * otherwise inserts a new row. Read or dismissed rows are never aggregated
   * into. The findFirst+create pair is not atomic across instances — under
   * horizontal scale a brief duplicate window is accepted (see OQ-NT-4).
   */
  async tryAggregate(input: NotificationEventInput): Promise<Notification> {
    const now = new Date();
    const aggregateUntil = new Date(
      now.getTime() + AGGREGATION_WINDOW_MINUTES * 60_000,
    );

    const { row, isAggregateUpdate } = await this.prisma.$transaction(
      async (tx) => {
        const open = await tx.notification.findFirst({
          where: {
            userId: input.userId,
            type: input.type,
            condominiumId: input.condominiumId,
            aggregateUntil: { gt: now },
            readAt: null,
            dismissedAt: null,
            // Never coalesce a new event into a currently-snoozed row, or the
            // new occurrence would inherit the snooze and stay hidden. A fresh
            // visible row is created instead.
            OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
          },
          orderBy: { aggregateUntil: 'desc' },
        });

        if (open) {
          const updated = await tx.notification.update({
            where: { id: open.id },
            data: {
              aggregateCount: { increment: 1 },
              aggregateUntil,
              linkUrl: input.linkUrl ?? null,
              ...(input.data !== undefined ? { data: input.data } : {}),
            },
          });
          return { row: updated, isAggregateUpdate: true };
        }

        const created = await tx.notification.create({
          data: {
            userId: input.userId,
            condominiumId: input.condominiumId,
            type: input.type,
            title: input.title,
            message: input.message,
            linkUrl: input.linkUrl ?? null,
            aggregateCount: 1,
            aggregateUntil,
            ...(input.data !== undefined ? { data: input.data } : {}),
          },
        });
        return { row: created, isAggregateUpdate: false };
      },
    );

    // SSE fan-out runs after the DB commit and is best-effort: a push failure
    // must never roll back the persisted notification.
    try {
      this.gateway.emitAfterWrite(row, isAggregateUpdate);
    } catch (err) {
      this.logger.warn(
        `SSE fan-out failed for notification ${row.id}: ${String(err)}`,
      );
    }

    // Web Push fan-out — every notification also pushes to the recipient's
    // subscribed device(s). Awaited (not fire-and-forget) so the delivery
    // completes before a serverless function can suspend; never throws.
    await this.dispatchWebPush(row);

    return row;
  }

  /**
   * Best-effort Web Push for a freshly written notification. Fans out to every
   * registered device for the recipient's (userId, condominiumId) pair so push
   * reaches their phone and desktop at once (notifications iter2 — multi-device).
   * Notifications without a user or condominium (e.g. ROOT cross-tenant rows)
   * have no per-tenant subscription and are skipped. Short-circuits when VAPID
   * is not configured so we avoid a DB read. Each send runs independently
   * (`Promise.allSettled`) so one dead device never blocks the others.
   */
  private async dispatchWebPush(row: Notification): Promise<void> {
    if (!row.userId || !row.condominiumId) return;
    if (!this.webPush.isConfigured()) return;
    try {
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: { userId: row.userId, condominiumId: row.condominiumId },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
      if (subscriptions.length === 0) return;
      await Promise.allSettled(
        subscriptions.map((sub) =>
          this.webPush.sendToSubscription(
            sub.id,
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            {
              title: row.title,
              body: row.message,
              // Per-notification tag so distinct alerts don't replace each other,
              // while a re-aggregated row reuses its tag to update in place.
              tag: `notification-${row.id}`,
              url: row.linkUrl ?? '/notifications',
            },
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `Web Push fan-out failed for notification ${row.id}: ${String(err)}`,
      );
    }
  }

  private async findOwnedOrThrow(
    condominiumId: string,
    id: string,
    userId: string,
  ): Promise<Notification> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, condominiumId },
    });
    // A user must never mutate another user's notification by guessing an id;
    // an ownership mismatch is reported as 404, not 403, to avoid disclosure.
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }
}
