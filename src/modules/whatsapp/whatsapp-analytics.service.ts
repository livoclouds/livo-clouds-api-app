import { Injectable } from '@nestjs/common';
import { WhatsAppConversationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsGranularity, AnalyticsQueryDto } from './dto/analytics-query.dto';

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface CommunicationsAnalytics {
  range: { from: string; to: string; granularity: AnalyticsGranularity };
  /** Lightweight counts — also consumed by the dashboard widget. */
  summary: {
    openEscalated: number;
    unread: number;
    today: number;
    totalConversations: number;
    oldestUnresolvedAgeHours: number | null;
  };
  conversationsOverTime: { bucket: string; count: number }[];
  escalation: {
    totalConversations: number;
    escalatedConversations: number;
    escalationRate: number;
  };
  topFaqs: { id: string; label: string; category: string | null; usageCount: number }[];
  resolution: { resolvedCount: number; medianHoursToResolution: number | null };
  unreadAging: {
    under24h: number;
    oneToThreeDays: number;
    threeToSevenDays: number;
    overSevenDays: number;
  };
}

/**
 * Lightweight communications analytics (Phase 5).
 *
 * Every query is scoped to a single condominium and aggregate-only — no message
 * text or resident PII is ever returned. System-channel conversations (the
 * admin-to-admin notification channel) are excluded so the metrics describe
 * resident traffic only.
 */
@Injectable()
export class WhatsAppAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    condominiumId: string,
    query: AnalyticsQueryDto,
  ): Promise<CommunicationsAnalytics> {
    const { from, to } = this.resolveRange(query);
    const granularity: AnalyticsGranularity = query.granularity ?? 'day';

    const baseInRange = {
      condominiumId,
      isSystemChannel: false,
      createdAt: { gte: from, lt: to },
    };

    const [
      conversationsOverTime,
      totalConversations,
      escalatedConversations,
      topFaqsRaw,
      resolution,
      summary,
      unreadAging,
    ] = await Promise.all([
      this.conversationsOverTime(condominiumId, from, to, granularity),
      this.prisma.whatsAppConversation.count({ where: baseInRange }),
      this.prisma.whatsAppConversation.count({
        where: { ...baseInRange, escalatedAt: { not: null } },
      }),
      this.prisma.whatsAppFaq.findMany({
        where: { condominiumId, usageCount: { gt: 0 } },
        orderBy: { usageCount: 'desc' },
        take: 5,
        select: { id: true, triggers: true, category: true, usageCount: true },
      }),
      this.resolutionStats(condominiumId, from, to),
      this.summaryCounts(condominiumId),
      this.unreadAging(condominiumId),
    ]);

    const escalationRate =
      totalConversations > 0
        ? Math.round((escalatedConversations / totalConversations) * 1000) / 10
        : 0;

    return {
      range: { from: from.toISOString(), to: to.toISOString(), granularity },
      summary: { ...summary, totalConversations },
      conversationsOverTime,
      escalation: { totalConversations, escalatedConversations, escalationRate },
      topFaqs: topFaqsRaw.map((f) => ({
        id: f.id,
        label: f.triggers[0] ?? f.category ?? '—',
        category: f.category,
        usageCount: f.usageCount,
      })),
      resolution,
      unreadAging,
    };
  }

  private async conversationsOverTime(
    condominiumId: string,
    from: Date,
    to: Date,
    granularity: AnalyticsGranularity,
  ): Promise<{ bucket: string; count: number }[]> {
    // `granularity` is whitelisted by the DTO and bound as a text parameter to
    // date_trunc(text, timestamptz) — no SQL injection surface.
    const rows = await this.prisma.$queryRaw<{ bucket: Date; count: number }[]>`
      SELECT date_trunc(${granularity}, "createdAt") AS bucket, count(*)::int AS count
      FROM whatsapp_conversations
      WHERE "condominiumId" = ${condominiumId}
        AND "isSystemChannel" = false
        AND "createdAt" >= ${from}
        AND "createdAt" < ${to}
      GROUP BY 1
      ORDER BY 1`;
    return rows.map((r) => ({
      bucket: new Date(r.bucket).toISOString(),
      count: Number(r.count),
    }));
  }

  private async resolutionStats(
    condominiumId: string,
    from: Date,
    to: Date,
  ): Promise<{ resolvedCount: number; medianHoursToResolution: number | null }> {
    const rows = await this.prisma.$queryRaw<
      { median_seconds: number | null; resolved_count: number }[]
    >`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt"))
        ) AS median_seconds,
        count(*)::int AS resolved_count
      FROM whatsapp_conversations
      WHERE "condominiumId" = ${condominiumId}
        AND "isSystemChannel" = false
        AND "status"::text = 'RESOLVED'
        AND "resolvedAt" IS NOT NULL
        AND "resolvedAt" >= ${from}
        AND "resolvedAt" < ${to}`;
    const row = rows[0];
    const medianSeconds =
      row && row.median_seconds != null ? Number(row.median_seconds) : null;
    return {
      resolvedCount: row ? Number(row.resolved_count) : 0,
      medianHoursToResolution:
        medianSeconds != null ? Math.round((medianSeconds / 3600) * 10) / 10 : null,
    };
  }

  private async summaryCounts(condominiumId: string): Promise<{
    openEscalated: number;
    unread: number;
    today: number;
    oldestUnresolvedAgeHours: number | null;
  }> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [openEscalated, unread, today, oldest] = await Promise.all([
      this.prisma.whatsAppConversation.count({
        where: {
          condominiumId,
          isSystemChannel: false,
          status: WhatsAppConversationStatus.ESCALATED,
        },
      }),
      this.prisma.whatsAppConversation.count({
        where: {
          condominiumId,
          isSystemChannel: false,
          unreadCountForAdmin: { gt: 0 },
          status: { not: WhatsAppConversationStatus.RESOLVED },
        },
      }),
      this.prisma.whatsAppConversation.count({
        where: {
          condominiumId,
          isSystemChannel: false,
          createdAt: { gte: startOfToday },
        },
      }),
      this.prisma.whatsAppConversation.findFirst({
        where: {
          condominiumId,
          isSystemChannel: false,
          status: { not: WhatsAppConversationStatus.RESOLVED },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const oldestUnresolvedAgeHours = oldest
      ? Math.round(((Date.now() - oldest.createdAt.getTime()) / HOUR_MS) * 10) / 10
      : null;

    return { openEscalated, unread, today, oldestUnresolvedAgeHours };
  }

  private async unreadAging(condominiumId: string): Promise<{
    under24h: number;
    oneToThreeDays: number;
    threeToSevenDays: number;
    overSevenDays: number;
  }> {
    const now = Date.now();
    const d1 = new Date(now - DAY_MS);
    const d3 = new Date(now - 3 * DAY_MS);
    const d7 = new Date(now - 7 * DAY_MS);
    const base = {
      condominiumId,
      isSystemChannel: false,
      unreadCountForAdmin: { gt: 0 },
      status: { not: WhatsAppConversationStatus.RESOLVED },
    } as const;

    const [under24h, oneToThreeDays, threeToSevenDays, overSevenDays] =
      await Promise.all([
        this.prisma.whatsAppConversation.count({
          where: { ...base, lastInboundAt: { gte: d1 } },
        }),
        this.prisma.whatsAppConversation.count({
          where: { ...base, lastInboundAt: { lt: d1, gte: d3 } },
        }),
        this.prisma.whatsAppConversation.count({
          where: { ...base, lastInboundAt: { lt: d3, gte: d7 } },
        }),
        this.prisma.whatsAppConversation.count({
          where: { ...base, lastInboundAt: { lt: d7 } },
        }),
      ]);

    return { under24h, oneToThreeDays, threeToSevenDays, overSevenDays };
  }

  private resolveRange(query: AnalyticsQueryDto): { from: Date; to: Date } {
    const now = Date.now();
    let to = query.to ? new Date(query.to) : new Date(now);
    let from = query.from
      ? new Date(query.from)
      : new Date(now - DEFAULT_RANGE_DAYS * DAY_MS);
    if (Number.isNaN(to.getTime())) to = new Date(now);
    if (Number.isNaN(from.getTime())) {
      from = new Date(now - DEFAULT_RANGE_DAYS * DAY_MS);
    }
    if (from.getTime() > to.getTime()) {
      from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    }
    // Clamp the window so an oversized range cannot trigger a heavy scan.
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      from = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS);
    }
    return { from, to };
  }
}
