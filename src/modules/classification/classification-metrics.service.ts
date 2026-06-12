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
 * Known caveat (documented, accepted): reclassifyBatch wipes and re-stamps rows
 * while historical override audits persist, so rates are a slight over-estimate
 * across reclassified batches (the same applies to matchedPatternLabel).
 *
 * Phase 4 (ENGINE-042): the pattern-label prerequisite is met — the engine now
 * persists `matchedPatternLabel` on every classified row and the manual-
 * correction audits carry it in beforeState, so `byPattern` slices override
 * rates per extraction pattern ("casa", "#", "banbajio:segment", …). Rows
 * classified before the Phase 4 deploy have a null label and are excluded from
 * byPattern (attribution starts at deploy).
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
  /** ENGINE-042: override rates per extraction pattern (matchedPatternLabel). */
  byPattern: ({ patternLabel: string } & PrecisionBucket)[];
}

interface OverrideRow {
  match_source: string | null;
  rule_id: string | null;
  pattern_label: string | null;
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
      SELECT "beforeState"->>'matchSource'         AS match_source,
             "beforeState"->>'matchedRuleId'       AS rule_id,
             "beforeState"->>'matchedPatternLabel' AS pattern_label,
             count(*)::int                         AS overridden
      FROM audit_logs
      WHERE "condominiumId" = ${condominiumId}
        AND module = 'classification'
        AND action IN (${OVERRIDE_ACTIONS[0]}, ${OVERRIDE_ACTIONS[1]}, ${OVERRIDE_ACTIONS[2]})
        AND "beforeState"->>'classificationStatus' = 'AUTO'
        AND "createdAt" >= ${from}
        AND "createdAt" < ${to}
      GROUP BY 1, 2, 3`;

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
    const survivingByPattern = await this.prisma.transaction.groupBy({
      by: ['matchedPatternLabel'],
      where: {
        condominiumId,
        classificationStatus: 'AUTO',
        matchedPatternLabel: { not: null },
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

    // ---- byPattern (ENGINE-042) ----
    const patternStillAuto = new Map<string, number>();
    for (const row of survivingByPattern) {
      if (row.matchedPatternLabel) {
        patternStillAuto.set(row.matchedPatternLabel, row._count._all);
      }
    }
    const patternOverridden = new Map<string, number>();
    for (const row of overrideRows) {
      if (!row.pattern_label) continue;
      patternOverridden.set(
        row.pattern_label,
        (patternOverridden.get(row.pattern_label) ?? 0) + Number(row.overridden),
      );
    }
    const patternKeys = new Set([
      ...patternStillAuto.keys(),
      ...patternOverridden.keys(),
    ]);
    const byPattern = [...patternKeys].sort().map((patternLabel) => ({
      patternLabel,
      ...makeBucket(
        patternStillAuto.get(patternLabel) ?? 0,
        patternOverridden.get(patternLabel) ?? 0,
      ),
    }));

    return {
      range: {
        from: range?.from?.toISOString() ?? null,
        to: range?.to?.toISOString() ?? null,
      },
      byMatchSource,
      byRule,
      byPattern,
    };
  }
}
