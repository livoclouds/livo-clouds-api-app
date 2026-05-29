import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MODULE_REGISTRY } from './module-registry';
import {
  ERROR_WINDOW_MINUTES,
  determineModuleStatus,
  rollUpOverall,
} from './status-rules';
import {
  ModuleHealth,
  ModuleHealthStatus,
  SystemStatusSnapshot,
} from './system-status.types';

const CACHE_TTL_MS = 45_000;
const IMPORTS_WINDOW_MS = 24 * 60 * 60 * 1000;

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Computes a real, on-demand health snapshot for every platform module and
 * caches it for {@link CACHE_TTL_MS}. The cache is the cost-control mechanism:
 * no matter how many ROOT admins view the page or how often they hit Refresh,
 * the underlying DB queries run at most once per TTL window — and not at all
 * while the page is closed.
 */
@Injectable()
export class SystemStatusService {
  private readonly logger = new Logger(SystemStatusService.name);
  private cache: { snapshot: SystemStatusSnapshot; expiresAt: number } | null =
    null;

  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(): Promise<SystemStatusSnapshot> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) {
      return this.cache.snapshot;
    }
    const snapshot = await this.computeSnapshot();
    this.cache = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
    return snapshot;
  }

  private async computeSnapshot(): Promise<SystemStatusSnapshot> {
    const checkedAtIso = new Date().toISOString();

    // 1. Database connectivity probe (measured round-trip).
    let dbReachable = true;
    const probeStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      dbReachable = false;
      this.logger.error(
        `System status DB probe failed: ${(err as Error).message}`,
      );
    }
    const dbLatencyMs = Date.now() - probeStart;

    // Per-module accumulators (normalised to lower-case module keys).
    const errorCounts = new Map<string, number>();
    const lastErrorAt = new Map<string, Date>();
    const lastActivityAt = new Map<string, Date>();
    let importsFailed = 0;
    let importsLast: Date | null = null;
    let importsLastFailedAt: Date | null = null;
    let whatsappError = 0;
    let whatsappLastError: Date | null = null;
    let whatsappLastActivity: Date | null = null;

    if (dbReachable) {
      const windowStart = new Date(
        Date.now() - ERROR_WINDOW_MINUTES * 60_000,
      );

      // 2. Batched audit-log aggregates — three grouped queries cover every
      //    audit-emitting module at once (cheap, index-backed).
      const [errGroups, lastErrGroups, activityGroups] = await Promise.all([
        this.prisma.auditLog.groupBy({
          by: ['module'],
          where: { result: 'ERROR', createdAt: { gte: windowStart } },
          _count: { _all: true },
        }),
        this.prisma.auditLog.groupBy({
          by: ['module'],
          where: { result: 'ERROR' },
          _max: { createdAt: true },
        }),
        this.prisma.auditLog.groupBy({
          by: ['module'],
          _max: { createdAt: true },
        }),
      ]);

      for (const g of errGroups) {
        const k = g.module.toLowerCase();
        errorCounts.set(k, (errorCounts.get(k) ?? 0) + g._count._all);
      }
      for (const g of lastErrGroups) {
        const k = g.module.toLowerCase();
        if (g._max.createdAt) {
          lastErrorAt.set(k, maxDate(lastErrorAt.get(k) ?? null, g._max.createdAt)!);
        }
      }
      for (const g of activityGroups) {
        const k = g.module.toLowerCase();
        if (g._max.createdAt) {
          lastActivityAt.set(
            k,
            maxDate(lastActivityAt.get(k) ?? null, g._max.createdAt)!,
          );
        }
      }

      // 3. Module-specific enrichment using richer real data.
      const importsSince = new Date(Date.now() - IMPORTS_WINDOW_MS);
      const [
        failedImports,
        lastBatch,
        lastFailedBatch,
        waErrors,
        waLastError,
        waLastWebhook,
      ] = await Promise.all([
        this.prisma.importBatch.count({
          where: { status: 'FAILED', createdAt: { gte: importsSince } },
        }),
        this.prisma.importBatch.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        this.prisma.importBatch.findFirst({
          where: { status: 'FAILED' },
          orderBy: { createdAt: 'desc' },
          select: { completedAt: true, createdAt: true },
        }),
        this.prisma.whatsAppCredential.count({ where: { status: 'ERROR' } }),
        this.prisma.whatsAppCredential.findFirst({
          where: { lastApiErrorAt: { not: null } },
          orderBy: { lastApiErrorAt: 'desc' },
          select: { lastApiErrorAt: true },
        }),
        this.prisma.whatsAppCredential.findFirst({
          where: { lastWebhookReceivedAt: { not: null } },
          orderBy: { lastWebhookReceivedAt: 'desc' },
          select: { lastWebhookReceivedAt: true },
        }),
      ]);

      importsFailed = failedImports;
      importsLast = lastBatch?.createdAt ?? null;
      importsLastFailedAt =
        lastFailedBatch?.completedAt ?? lastFailedBatch?.createdAt ?? null;
      whatsappError = waErrors;
      whatsappLastError = waLastError?.lastApiErrorAt ?? null;
      whatsappLastActivity = waLastWebhook?.lastWebhookReceivedAt ?? null;
    }

    // 4. Build per-module health from the accumulated signals.
    const modules: ModuleHealth[] = MODULE_REGISTRY.map((entry) => {
      const key = entry.key;
      const errorsInWindow = entry.hasAuditSignal
        ? errorCounts.get(key) ?? 0
        : 0;

      let lastValidUpdate = entry.hasAuditSignal
        ? lastActivityAt.get(key) ?? null
        : null;
      let incidentAt = entry.hasAuditSignal
        ? lastErrorAt.get(key) ?? null
        : null;

      const response: Record<string, unknown> = {
        dbReachable,
        hasAuditSignal: entry.hasAuditSignal,
        errorsInWindow,
        errorWindowMinutes: ERROR_WINDOW_MINUTES,
        lastErrorAt: (entry.hasAuditSignal
          ? lastErrorAt.get(key) ?? null
          : null
        )?.toISOString() ?? null,
        lastActivityAt: (entry.hasAuditSignal
          ? lastActivityAt.get(key) ?? null
          : null
        )?.toISOString() ?? null,
      };

      let source = entry.hasAuditSignal
        ? `Prisma SELECT 1 (DB probe) + AuditLog where lower(module)='${key}' over last ${ERROR_WINDOW_MINUTES}m (error count, last error, last activity).`
        : `Prisma SELECT 1 (DB probe). This module emits no AuditLog activity, so status reflects database reachability only.`;

      let importsFailed24h: number | undefined;
      let whatsappErrorCount: number | undefined;

      if (entry.enrichment === 'imports') {
        importsFailed24h = importsFailed;
        response.importsFailed24h = importsFailed;
        response.lastImportAt = importsLast?.toISOString() ?? null;
        response.lastFailedImportAt = importsLastFailedAt?.toISOString() ?? null;
        source += ' + ImportBatch FAILED count over last 24h.';
        lastValidUpdate = maxDate(lastValidUpdate, importsLast);
        if (importsLastFailedAt) {
          incidentAt = maxDate(incidentAt, importsLastFailedAt);
        }
      }

      if (entry.enrichment === 'whatsapp') {
        whatsappErrorCount = whatsappError;
        response.whatsappCredentialsInError = whatsappError;
        response.lastApiErrorAt = whatsappLastError?.toISOString() ?? null;
        response.lastWebhookReceivedAt =
          whatsappLastActivity?.toISOString() ?? null;
        source +=
          ' + WhatsAppCredential status=ERROR count, lastApiErrorAt, lastWebhookReceivedAt.';
        lastValidUpdate = maxDate(lastValidUpdate, whatsappLastActivity);
        if (whatsappLastError) {
          incidentAt = maxDate(incidentAt, whatsappLastError);
        }
      }

      const verdict = determineModuleStatus({
        dbReachable,
        hasAuditSignal: entry.hasAuditSignal,
        errorsInWindow,
        importsFailed24h,
        whatsappErrorCount,
      });

      return {
        key,
        category: entry.category,
        status: verdict.status,
        checkedAt: checkedAtIso,
        lastValidUpdateAt: lastValidUpdate?.toISOString() ?? null,
        latencyMs: dbLatencyMs,
        technical: {
          source,
          response,
          determination: verdict.determination,
        },
        recentIncident: {
          at: incidentAt?.toISOString() ?? null,
          summary: incidentAt
            ? `Most recent error/failure recorded for the ${key} module.`
            : null,
        },
      };
    });

    const counts = {
      total: modules.length,
      operational: modules.filter((m) => m.status === 'operational').length,
      degraded: modules.filter((m) => m.status === 'degraded').length,
      outage: modules.filter((m) => m.status === 'outage').length,
    };

    const overall: ModuleHealthStatus = rollUpOverall(
      modules.map((m) => m.status),
    );

    return {
      generatedAt: checkedAtIso,
      cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
      dbLatencyMs,
      overall,
      counts,
      modules,
    };
  }
}
