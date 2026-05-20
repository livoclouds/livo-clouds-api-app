import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Notification,
  NotificationType,
  Prisma,
  RootScope,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AGGREGATION_WINDOW_MINUTES,
  NOTIFICATION_R1_TYPES,
} from './notifications.constants';

export interface ListNotificationsParams {
  userId: string;
  /** Tenant-scoped listing. Omit for the ROOT cross-tenant `/me` inbox. */
  condominiumId?: string;
  page: number;
  limit: number;
  unreadOnly?: boolean;
  includeDismissed?: boolean;
  types?: NotificationType[];
  from?: string;
  to?: string;
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

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async list(params: ListNotificationsParams) {
    const { userId, condominiumId, page, limit } = params;

    const where: Prisma.NotificationWhereInput = { userId };
    if (condominiumId) {
      where.condominiumId = condominiumId;
    }
    if (params.unreadOnly) {
      where.readAt = null;
    }
    if (!params.includeDismissed) {
      where.dismissedAt = null;
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
    };
    if (condominiumId) {
      unreadWhere.condominiumId = condominiumId;
    }

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
      where: { condominiumId, userId, readAt: null, dismissedAt: null },
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

  async getPreferences(userId: string) {
    const rows = await this.prisma.userNotificationPreference.findMany({
      where: { userId },
    });
    const overrides = new Map(rows.map((row) => [row.type, row.enabled]));

    // Missing rows default to enabled (opt-out model). Only the r1 types are
    // surfaced; role-based filtering arrives with the Phase 2 role matrix.
    const preferences: Record<string, boolean> = {};
    for (const type of NOTIFICATION_R1_TYPES) {
      preferences[type] = overrides.get(type) ?? true;
    }
    return { preferences };
  }

  async updatePreferences(userId: string, input: Record<string, boolean>) {
    const allowed = new Set<string>(NOTIFICATION_R1_TYPES);
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

    return this.getPreferences(userId);
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
   * Entry point for domain event listeners (Phase 3). Delegates to the
   * aggregation path so repeated events of the same kind coalesce.
   */
  async createForEvent(input: NotificationEventInput): Promise<Notification> {
    return this.tryAggregate(input);
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

    return this.prisma.$transaction(async (tx) => {
      const open = await tx.notification.findFirst({
        where: {
          userId: input.userId,
          type: input.type,
          condominiumId: input.condominiumId,
          aggregateUntil: { gt: now },
          readAt: null,
          dismissedAt: null,
        },
        orderBy: { aggregateUntil: 'desc' },
      });

      if (open) {
        return tx.notification.update({
          where: { id: open.id },
          data: {
            aggregateCount: { increment: 1 },
            aggregateUntil,
            linkUrl: input.linkUrl ?? null,
            ...(input.data !== undefined ? { data: input.data } : {}),
          },
        });
      }

      return tx.notification.create({
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
    });
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
