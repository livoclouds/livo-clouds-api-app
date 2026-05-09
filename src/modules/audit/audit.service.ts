import { Injectable } from '@nestjs/common';
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
          user: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: logs,
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
          user: { select: { id: true, firstName: true, lastName: true, role: true } },
          condominium: { select: { id: true, slug: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async log(data: {
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
  }) {
    return this.prisma.auditLog.create({ data: data as Parameters<typeof this.prisma.auditLog.create>[0]['data'] });
  }
}
