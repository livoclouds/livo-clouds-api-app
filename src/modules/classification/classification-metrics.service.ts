import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ENGINE-058 — classification precision-measurement harness.
 *
 * Derives override rates from data that already exists:
 *  - Numerator (overridden): immutable audit_logs rows written by the three
 *    manual-correction paths (manualMatch / manualClassify / unmatch), filtered
 *    to corrections of rows the engine had auto-classified
 *    (`beforeState->>'classificationStatus' = 'AUTO'`). A manual completion of
 *    a NEEDS_REVIEW row is NOT an override — counting it would poison the
 *    precision baseline.
 *  - Denominator (autoTotal): surviving AUTO rows on the live transactions
 *    table + the overridden count (an override rewrites matchSource to MANUAL
 *    and nulls matchedRuleId, so the live table alone undercounts).
 *
 * Known caveat (documented, accepted for the Phase 4 baseline): reclassifyBatch
 * wipes and re-stamps rows while historical override audits persist, so rates
 * are a slight over-estimate across reclassified batches. Per-UNIT_PATTERNS
 * label attribution is not recoverable from existing data — metrics are scoped
 * to matchSource + matchedRuleId (persisting the pattern label is the Phase 4
 * prerequisite).
 */

/** Bucket for corrections whose audit beforeState carried no matchSource
 * (e.g. the multi-unit allocation variant of manualClassify). */
const UNKNOWN_SOURCE = 'UNKNOWN';

const OVERRIDE_ACTIONS = [
  'TRANSACTION_MATCHED_MANUALLY',
  'TRANSACTION_CLASSIFIED_MANUALLY',
  'TRANSACTION_UNMATCHED',
];

export interface PrecisionBucket {
  autoTotal: number;
  stillAuto: number;
  overridden: number;
  /** overridden / autoTotal, 0 when autoTotal is 0. Rounded to 4 decimals. */
  overrideRate: number;
}

export interface PrecisionMetrics {
  range: { from: string | null; to: string | null };
  byMatchSource: ({ matchSource: string } & PrecisionBucket)[];
  byRule: ({ ruleId: string; ruleName: string | null } & PrecisionBucket)[];
}

interface OverrideRow {
  match_source: string | null;
  rule_id: string | null;
  overridden: number;
}

function makeBucket(stillAuto: number, overridden: number): PrecisionBucket {
  const autoTotal = stillAuto + overridden;
  return {
    autoTotal,
    stillAuto,
    overridden,
    overrideRate:
      autoTotal === 0 ? 0 : Math.round((overridden / autoTotal) * 10_000) / 10_000,
  };
}

@Injectable()
export class ClassificationMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPrecisionMetrics(
    condominiumId: string,
    range?: { from?: Date; to?: Date },
  ): Promise<PrecisionMetrics> {
    const from = range?.from ?? new Date(0);
    const to = range?.to ?? new Date('9999-12-31T00:00:00Z');

    // Overrides, grouped by what the engine had stamped before the correction.
    // audit_logs is indexed on condominiumId/module/action/createdAt; the JSONB
    // extraction only runs over the pre-filtered rows. Insert-only table — reads
    // are unaffected by the immutability trigger.
    const overrideRows = await this.prisma.$queryRaw<OverrideRow[]>`
      SELECT "beforeState"->>'matchSource'   AS match_source,
             "beforeState"->>'matchedRuleId' AS rule_id,
             count(*)::int                   AS overridden
      FROM audit_logs
      WHERE "condominiumId" = ${condominiumId}
        AND module = 'classification'
        AND action IN (${OVERRIDE_ACTIONS[0]}, ${OVERRIDE_ACTIONS[1]}, ${OVERRIDE_ACTIONS[2]})
        AND "beforeState"->>'classificationStatus' = 'AUTO'
        AND "createdAt" >= ${from}
        AND "createdAt" < ${to}
      GROUP BY 1, 2`;

    // Surviving AUTO rows (the engine's classifications nobody corrected).
    const survivingBySource = await this.prisma.transaction.groupBy({
      by: ['matchSource'],
      where: { condominiumId, classificationStatus: 'AUTO' },
      _count: { _all: true },
    });
    const survivingByRule = await this.prisma.transaction.groupBy({
      by: ['matchedRuleId'],
      where: {
        condominiumId,
        classificationStatus: 'AUTO',
        matchedRuleId: { not: null },
      },
      _count: { _all: true },
    });

    // ---- byMatchSource ----
    const sourceStillAuto = new Map<string, number>();
    for (const row of survivingBySource) {
      sourceStillAuto.set(row.matchSource ?? UNKNOWN_SOURCE, row._count._all);
    }
    const sourceOverridden = new Map<string, number>();
    for (const row of overrideRows) {
      const key = row.match_source ?? UNKNOWN_SOURCE;
      sourceOverridden.set(
        key,
        (sourceOverridden.get(key) ?? 0) + Number(row.overridden),
      );
    }
    const sourceKeys = new Set([
      ...sourceStillAuto.keys(),
      ...sourceOverridden.keys(),
    ]);
    const byMatchSource = [...sourceKeys]
      .sort()
      .map((matchSource) => ({
        matchSource,
        ...makeBucket(
          sourceStillAuto.get(matchSource) ?? 0,
          sourceOverridden.get(matchSource) ?? 0,
        ),
      }));

    // ---- byRule ----
    const ruleStillAuto = new Map<string, number>();
    for (const row of survivingByRule) {
      if (row.matchedRuleId) ruleStillAuto.set(row.matchedRuleId, row._count._all);
    }
    const ruleOverridden = new Map<string, number>();
    for (const row of overrideRows) {
      if (!row.rule_id) continue;
      ruleOverridden.set(
        row.rule_id,
        (ruleOverridden.get(row.rule_id) ?? 0) + Number(row.overridden),
      );
    }
    const ruleIds = [
      ...new Set([...ruleStillAuto.keys(), ...ruleOverridden.keys()]),
    ];
    const ruleNames = ruleIds.length
      ? await this.prisma.reconciliationRule.findMany({
          where: { id: { in: ruleIds }, condominiumId },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(ruleNames.map((r) => [r.id, r.name]));
    const byRule = ruleIds.sort().map((ruleId) => ({
      ruleId,
      ruleName: nameById.get(ruleId) ?? null, // null when the rule was deleted
      ...makeBucket(
        ruleStillAuto.get(ruleId) ?? 0,
        ruleOverridden.get(ruleId) ?? 0,
      ),
    }));

    return {
      range: {
        from: range?.from?.toISOString() ?? null,
        to: range?.to?.toISOString() ?? null,
      },
      byMatchSource,
      byRule,
    };
  }
}
