import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtPayload, UserRole } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditQuery {
  page?: number;
  limit?: number;
  module?: string;
  action?: string;
  result?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async findAll(condominiumId: string, query: AuditQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { condominiumId };

    if (query.module) where.module = query.module;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.result) where.result = query.result;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, roleRef: { select: { key: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: this.withActorRole(logs),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findPlatformLogs(user: JwtPayload, query: AuditQuery) {
    if (user.role !== UserRole.ROOT) {
      return this.findAll(user.condominiumId!, query);
    }

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.module) where.module = query.module;
    if (query.result) where.result = query.result;

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, roleRef: { select: { key: true } } } },
          condominium: { select: { id: true, slug: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: this.withActorRole(logs),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // Flatten the actor's roleRef.key back to a `role` field so the audit response
  // contract is unchanged after the legacy role enum column was removed.
  private withActorRole<
    U extends { roleRef: { key: string | null } | null },
    T extends { user: U | null },
  >(logs: T[]) {
    return logs.map((l) =>
      l.user
        ? { ...l, user: { ...l.user, role: l.user.roleRef?.key ?? null, roleRef: undefined } }
        : l,
    );
  }

  async log(
    data: {
      condominiumId?: string;
      userId: string;
      action: string;
      actionCategory: string;
      module: string;
      entityType?: string;
      entityId?: string;
      beforeState?: unknown;
      afterState?: unknown;
      ipAddress?: string;
      userAgent?: string;
      result?: 'SUCCESS' | 'WARNING' | 'ERROR';
      description?: string;
    },
    // When a transaction client is supplied the audit row is written on that
    // client, so it commits or rolls back atomically with the caller's mutation.
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.auditLog.create({ data: data as Parameters<typeof this.prisma.auditLog.create>[0]['data'] });
  }
}
