import { Injectable, Logger, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { MatchSource, ClassificationStatus, RequiresReviewReason, ReconciliationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReconciliationRulesService } from '../reconciliation-rules/reconciliation-rules.service';
import { matchTerraceBooking, type TerraceCandidate } from './terrace-booking-matcher';
import { validateTerraceMetadata } from '../calendar/terrace-metadata.validator';

interface ResidentData {
  id: string;
  unitNumber: string;
  firstName: string;
  lastName: string;
}

interface DbRule {
  id: string;
  keywords: string[];
  unitPatterns: string[];
  conceptType: string | null;
  confidenceThreshold: Prisma.Decimal;
}

interface TextExtraction {
  unitNumberDetected: string | null;
  unitConfidence: number;
  payerNameDetected: string | null;
  paymentConcept: string | null;
  paymentPeriodYear: number | null;
  paymentPeriodMonth: number | null;
}

interface MatchResult {
  residentId: string | null;
  matchSource: MatchSource | null;
  confidenceScore: number;
  classificationStatus: ClassificationStatus;
  requiresReviewReason: RequiresReviewReason | null;
  matchedRuleId: string | null;
  matchedCalendarEventId: string | null;
  matchedAt: Date | null;
}

export interface ClassificationResult extends TextExtraction, MatchResult {}

export interface ClassificationSummary {
  total: number;
  classified: number;
  needsReview: number;
  unmatched: number;
}

const UNIT_PATTERNS: { regex: RegExp; confidence: number }[] = [
  { regex: /\bcasa\s+(\d{1,4}[a-z]?)\b/i, confidence: 0.95 },
  { regex: /\bunidad\s+(\d{1,4}[a-z]?)\b/i, confidence: 0.95 },
  { regex: /\blote\s+(\d{1,4}[a-z]?)\b/i, confidence: 0.9 },
  { regex: /\bc\.?\s*(\d{1,4}[a-z]?)\b/i, confidence: 0.85 },
  { regex: /\bdepto?\.?\s*(\d{1,4}[a-z]?)\b/i, confidence: 0.85 },
  { regex: /#\s*(\d{1,4}[a-z]?)\b/i, confidence: 0.8 },
];

const CONCEPT_PATTERNS: { regex: RegExp; concept: string }[] = [
  { regex: /mantenimiento|cuota\s+mensual|mensualidad|mant\b/i, concept: 'MAINTENANCE' },
  { regex: /deposito|dep[oó]sito|garant[ií]a/i, concept: 'DEPOSIT' },
  { regex: /multa|sanci[oó]n|infracci[oó]n/i, concept: 'FINE' },
  { regex: /\bagua\b|\bluz\b|electricidad|internet|\bgas\b/i, concept: 'UTILITY' },
  { regex: /estacionamiento|parking|caj[oó]n/i, concept: 'PARKING' },
  { regex: /terraza|alberca|sal[oó]n|amenidad/i, concept: 'AMENITY' },
];

const MONTH_MAP: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may_: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

const PAYER_PATTERNS: RegExp[] = [
  /nombre:\s*([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+ref|\s+\d|$)/i,
  /de:\s*([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+ref|\s+\d|$)/i,
  /pago\s+de\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\s+casa|\s+unidad|\s+c\d|\s+\d|$)/i,
];

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinSimilarity(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 && n === 0) return 1;
  if (m === 0 || n === 0) return 0;

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

function extractFromText(description: string): TextExtraction {
  const normalized = normalizeText(description);

  let unitNumberDetected: string | null = null;
  let unitConfidence = 0;
  for (const { regex, confidence } of UNIT_PATTERNS) {
    const match = normalized.match(regex);
    if (match) {
      unitNumberDetected = match[1].toUpperCase();
      unitConfidence = confidence;
      break;
    }
  }

  let paymentConcept: string | null = null;
  for (const { regex, concept } of CONCEPT_PATTERNS) {
    if (regex.test(normalized)) {
      paymentConcept = concept;
      break;
    }
  }

  let paymentPeriodMonth: number | null = null;
  let paymentPeriodYear: number | null = null;
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    const key = name === 'may_' ? 'may' : name;
    if (normalized.includes(key)) {
      paymentPeriodMonth = num;
      break;
    }
  }
  const yearMatch = normalized.match(/20(\d{2})/);
  if (yearMatch) {
    paymentPeriodYear = parseInt(`20${yearMatch[1]}`, 10);
  }

  let payerNameDetected: string | null = null;
  for (const pattern of PAYER_PATTERNS) {
    const match = description.match(pattern);
    if (match) {
      payerNameDetected = match[1].trim();
      break;
    }
  }

  return {
    unitNumberDetected,
    unitConfidence,
    payerNameDetected,
    paymentConcept,
    paymentPeriodYear,
    paymentPeriodMonth,
  };
}

function applyDbRules(
  description: string,
  rules: DbRule[],
): { matchedRule: DbRule; score: number } | null {
  const normalized = normalizeText(description);

  for (const rule of rules) {
    const allKeywordsMatch = rule.keywords.length > 0 &&
      rule.keywords.every((kw) => normalized.includes(normalizeText(kw)));

    const patternMatch = rule.unitPatterns.length > 0 &&
      rule.unitPatterns.some((p) => {
        try {
          return new RegExp(p, 'i').test(normalized);
        } catch {
          return false;
        }
      });

    if (allKeywordsMatch || (rule.unitPatterns.length > 0 && patternMatch)) {
      return { matchedRule: rule, score: Number(rule.confidenceThreshold) };
    }
  }

  return null;
}

function deriveResidentIdFromUnit(
  unitNumberDetected: string | null,
  residents: ResidentData[],
): string | null {
  if (!unitNumberDetected) return null;
  const target = normalizeText(unitNumberDetected);
  const matches = residents.filter((r) => normalizeText(r.unitNumber) === target);
  return matches.length === 1 ? matches[0].id : null;
}

function matchToResident(
  extraction: TextExtraction,
  residents: ResidentData[],
): MatchResult {
  // Pass 1: exact unit number match
  if (extraction.unitNumberDetected) {
    const normalizedDetected = normalizeText(extraction.unitNumberDetected);
    const matches = residents.filter(
      (r) => normalizeText(r.unitNumber) === normalizedDetected,
    );

    if (matches.length === 1) {
      const found = matches[0];
      const score = extraction.unitConfidence;
      const isAuto = score >= 0.8;
      return {
        residentId: isAuto ? found.id : null,
        matchSource: MatchSource.AUTO_UNIT_NUMBER,
        confidenceScore: score,
        classificationStatus: isAuto ? ClassificationStatus.AUTO : ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: isAuto ? null : RequiresReviewReason.LOW_CONFIDENCE,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        matchedAt: isAuto ? new Date() : null,
      };
    }

    if (matches.length > 1) {
      return {
        residentId: null,
        matchSource: MatchSource.AUTO_UNIT_NUMBER,
        confidenceScore: extraction.unitConfidence,
        classificationStatus: ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: RequiresReviewReason.UNIT_AMBIGUOUS,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        matchedAt: null,
      };
    }

    return {
      residentId: null,
      matchSource: null,
      confidenceScore: 0,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.UNIT_NOT_FOUND,
      matchedRuleId: null,
      matchedCalendarEventId: null,
      matchedAt: null,
    };
  }

  // Pass 2: fuzzy name match
  if (extraction.payerNameDetected) {
    const normalizedPayer = normalizeText(extraction.payerNameDetected);
    let bestScore = 0;
    let bestResident: ResidentData | null = null;
    let matchCount = 0;

    for (const r of residents) {
      const fullName = normalizeText(`${r.firstName} ${r.lastName}`);
      const score = levenshteinSimilarity(normalizedPayer, fullName);
      if (score >= 0.75) {
        matchCount++;
        if (score > bestScore) {
          bestScore = score;
          bestResident = r;
        }
      }
    }

    if (bestResident) {
      const multipleMatches = matchCount > 1;
      const isAuto = !multipleMatches && bestScore >= 0.8;
      return {
        residentId: isAuto ? bestResident.id : null,
        matchSource: MatchSource.AUTO_NAME,
        confidenceScore: bestScore,
        classificationStatus: isAuto ? ClassificationStatus.AUTO : ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: isAuto ? null : (multipleMatches ? RequiresReviewReason.NAME_AMBIGUOUS : RequiresReviewReason.LOW_CONFIDENCE),
        matchedRuleId: null,
        matchedCalendarEventId: null,
        matchedAt: isAuto ? new Date() : null,
      };
    }

    return {
      residentId: null,
      matchSource: null,
      confidenceScore: 0,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.NAME_NOT_FOUND,
      matchedRuleId: null,
      matchedCalendarEventId: null,
      matchedAt: null,
    };
  }

  // Pass 3: no match
  return {
    residentId: null,
    matchSource: null,
    confidenceScore: 0,
    classificationStatus: ClassificationStatus.NEEDS_REVIEW,
    requiresReviewReason: RequiresReviewReason.NO_MATCH,
    matchedRuleId: null,
    matchedCalendarEventId: null,
    matchedAt: null,
  };
}

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rulesService: ReconciliationRulesService,
  ) {}

  classifyTransaction(
    description: string,
    residents: ResidentData[],
    rules: DbRule[] = [],
    terraceContext?: {
      events: TerraceCandidate[];
      amount: number | null;
      transactionDate: Date;
      detectedResidentId?: string | null;
      // Phase 5F (KI-004): tenant-level keywords loaded once per batch from
      // CondominiumSettings.terraceGlobalKeywords and threaded through.
      globalKeywords?: string[];
    },
  ): ClassificationResult {
    const extraction = extractFromText(description);

    // Pass 0: DB-driven rules (priority order, first match wins)
    const ruleMatch = applyDbRules(description, rules);
    if (ruleMatch) {
      const { matchedRule, score } = ruleMatch;
      const isAuto = score >= 0.8;
      return {
        ...extraction,
        paymentConcept: matchedRule.conceptType ?? extraction.paymentConcept,
        residentId: null,
        matchSource: MatchSource.RULE,
        confidenceScore: score,
        classificationStatus: isAuto ? ClassificationStatus.AUTO : ClassificationStatus.NEEDS_REVIEW,
        requiresReviewReason: isAuto ? null : RequiresReviewReason.LOW_CONFIDENCE,
        matchedRuleId: matchedRule.id,
        matchedCalendarEventId: null,
        matchedAt: isAuto ? new Date() : null,
      };
    }

    // Pass 0.5: terrace booking matching — only for INCOME transactions with amount data.
    if (
      terraceContext &&
      terraceContext.events.length > 0 &&
      terraceContext.amount !== null &&
      terraceContext.amount > 0
    ) {
      const terraceResult = matchTerraceBooking(
        {
          amount: terraceContext.amount,
          transactionDate: terraceContext.transactionDate,
          description,
          detectedResidentId:
            terraceContext.detectedResidentId
            ?? deriveResidentIdFromUnit(extraction.unitNumberDetected, residents),
          detectedUnitNumber: extraction.unitNumberDetected,
          globalKeywords: terraceContext.globalKeywords,
        },
        terraceContext.events,
      );
      if (terraceResult) {
        return {
          ...extraction,
          paymentConcept: terraceResult.paymentConcept,
          residentId: terraceResult.residentId,
          matchSource: MatchSource[terraceResult.matchSource],
          confidenceScore: terraceResult.confidenceScore,
          classificationStatus: ClassificationStatus[terraceResult.classificationStatus],
          requiresReviewReason: terraceResult.requiresReviewReason
            ? RequiresReviewReason[terraceResult.requiresReviewReason]
            : null,
          matchedRuleId: null,
          matchedCalendarEventId: terraceResult.matchedCalendarEventId,
          matchedAt: terraceResult.matchedAt,
        };
      }
    }

    const match = matchToResident(extraction, residents);
    return { ...extraction, ...match };
  }

  async classifyBatch(
    condominiumId: string,
    batchId: string,
  ): Promise<ClassificationSummary> {
    const [residents, transactions, activeRules, rawTerraceEvents, settings] = await Promise.all([
      this.prisma.resident.findMany({
        where: { condominiumId, deletedAt: null },
        select: { id: true, unitNumber: true, firstName: true, lastName: true },
      }),
      this.prisma.transaction.findMany({
        where: { condominiumId, importBatchId: batchId },
        select: { id: true, description: true, transactionDate: true, credits: true, charges: true, flowType: true },
      }),
      this.rulesService.findActive(condominiumId),
      // Load active, non-cancelled TERRACE_BOOKING events with PENDING payment status.
      this.prisma.calendarEvent.findMany({
        where: {
          condominiumId,
          eventType: 'TERRACE_BOOKING',
          status: { not: 'CANCELLED' },
          deletedAt: null,
        },
        select: { id: true, residentId: true, unitNumber: true, startDate: true, metadata: true },
      }),
      // Phase 5F (KI-004): tenant-level terrace keywords merged into Pass 0.5.
      this.prisma.condominiumSettings.findUnique({
        where: { condominiumId },
        select: { terraceGlobalKeywords: true },
      }),
    ]);
    const terraceGlobalKeywords = settings?.terraceGlobalKeywords ?? [];

    // Parse terrace metadata and filter to events with PENDING payment.
    const terraceEvents: TerraceCandidate[] = rawTerraceEvents.flatMap((ev) => {
      const validation = validateTerraceMetadata(ev.metadata);
      if (!validation.valid || validation.data.paymentStatus !== 'PENDING') return [];
      return [{
        id: ev.id,
        residentId: ev.residentId,
        unitNumber: ev.unitNumber,
        startDate: new Date(ev.startDate),
        terraceRentalAmount: validation.data.terraceRentalAmount,
        customKeywords: validation.data.customKeywords,
      }];
    });

    let classified = 0;
    let needsReview = 0;
    let unmatched = 0;

    const CHUNK = 200;
    for (let i = 0; i < transactions.length; i += CHUNK) {
      const chunk = transactions.slice(i, i + CHUNK);
      // Single timestamp per chunk so auto-matched rows with identical
      // payloads can collapse into the same updateMany group. The roadmap
      // (Phase 3 validation) explicitly excludes matchedAt from the
      // byte-for-byte equivalence requirement.
      const nowForChunk = new Date();

      const groups = new Map<string, { ids: string[]; data: Prisma.TransactionUncheckedUpdateManyInput }>();

      for (const tx of chunk) {
        const terraceContext = tx.flowType === 'INCOME' && terraceEvents.length > 0
          ? {
              events: terraceEvents,
              amount: tx.credits ? Number(tx.credits) : null,
              transactionDate: new Date(tx.transactionDate),
              globalKeywords: terraceGlobalKeywords,
            }
          : undefined;

        const result = this.classifyTransaction(tx.description, residents, activeRules, terraceContext);

        const data: Prisma.TransactionUncheckedUpdateManyInput = {
          unitNumberDetected: result.unitNumberDetected,
          payerNameDetected: result.payerNameDetected,
          paymentConcept: result.paymentConcept,
          paymentPeriodYear: result.paymentPeriodYear,
          paymentPeriodMonth: result.paymentPeriodMonth,
          matchSource: result.matchSource,
          confidenceScore: result.confidenceScore
            ? new Prisma.Decimal(result.confidenceScore.toFixed(4))
            : null,
          matchedAt: result.matchedAt ? nowForChunk : null,
          residentId: result.residentId,
          classificationStatus: result.classificationStatus,
          requiresReviewReason: result.requiresReviewReason ?? null,
          matchedRuleId: result.matchedRuleId ?? null,
          matchedCalendarEventId: result.matchedCalendarEventId ?? null,
        };

        const key = JSON.stringify(data, (_k, v) =>
          v instanceof Prisma.Decimal ? v.toString() : v,
        );
        const existing = groups.get(key);
        if (existing) {
          existing.ids.push(tx.id);
        } else {
          groups.set(key, { ids: [tx.id], data });
        }

        if (result.classificationStatus === ClassificationStatus.AUTO) {
          classified++;
        } else {
          needsReview++;
          if (!result.residentId) unmatched++;
        }
      }

      const updates = Array.from(groups.values()).map(({ ids, data }) =>
        this.prisma.transaction.updateMany({
          where: { condominiumId, id: { in: ids } },
          data,
        }),
      );
      await this.prisma.$transaction(updates);
    }

    await this.upsertMonthlySummaries(condominiumId, batchId);

    return { total: transactions.length, classified, needsReview, unmatched };
  }

  async reclassifyBatch(
    condominiumId: string,
    batchId: string,
    userId: string | null,
  ): Promise<ClassificationSummary> {
    const beforeCounts = await this.prisma.transaction.groupBy({
      by: ['classificationStatus'],
      where: { condominiumId, importBatchId: batchId },
      _count: { _all: true },
    });
    const beforeSummary = beforeCounts.reduce<Record<string, number>>(
      (acc, row) => {
        acc[row.classificationStatus] = row._count._all;
        return acc;
      },
      {},
    );

    await this.prisma.transaction.updateMany({
      where: { condominiumId, importBatchId: batchId },
      data: {
        classificationStatus: ClassificationStatus.NEEDS_REVIEW,
        residentId: null,
        matchSource: null,
        confidenceScore: null,
        matchedAt: null,
        requiresReviewReason: null,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        classificationVersion: { increment: 1 },
      },
    });
    const summary = await this.classifyBatch(condominiumId, batchId);

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'BATCH_RECLASSIFIED',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'ImportBatch',
          entityId: batchId,
          beforeState: { counts: beforeSummary },
          afterState: {
            total: summary.total,
            classified: summary.classified,
            needsReview: summary.needsReview,
            unmatched: summary.unmatched,
          },
          result: 'SUCCESS',
          description: `Batch reclassified: ${summary.total} transactions processed`,
        },
      });
    }

    return summary;
  }

  async manualMatch(
    condominiumId: string,
    transactionId: string,
    residentId: string,
    userId: string,
  ): Promise<void> {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
    });
    if (!resident) {
      throw new Error('Resident not found in this condominium');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          residentId: true,
          matchSource: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
        },
      });
      if (!existing) throw new NotFoundException('Transaction not found');

      const result = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: existing.updatedAt,
        },
        data: {
          residentId,
          matchSource: MatchSource.MANUAL,
          confidenceScore: new Prisma.Decimal('1.0000'),
          matchedAt: new Date(),
          classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
          requiresReviewReason: null,
          matchedRuleId: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_MATCHED_MANUALLY',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: {
            residentId: existing.residentId,
            matchSource: existing.matchSource,
            classificationStatus: existing.classificationStatus,
            requiresReviewReason: existing.requiresReviewReason,
            matchedRuleId: existing.matchedRuleId,
          },
          afterState: {
            residentId,
            matchSource: MatchSource.MANUAL,
            classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
            requiresReviewReason: null,
            matchedRuleId: null,
          },
          result: 'SUCCESS',
        },
      });
    });
  }

  async manualClassify(
    condominiumId: string,
    transactionId: string,
    dto: {
      unitNumber?: string;
      paymentConcept?: string;
      paymentPeriodMonth?: number;
      paymentPeriodYear?: number;
      transactionDate?: string;
      description?: string;
    },
    userId: string,
  ): Promise<void> {
    let residentId: string | undefined;
    if (dto.unitNumber) {
      const resident = await this.prisma.resident.findFirst({
        where: { condominiumId, unitNumber: dto.unitNumber, deletedAt: null },
        select: { id: true },
      });
      if (resident) residentId = resident.id;
    }

    await this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          description: true,
          residentId: true,
          unitNumberDetected: true,
          paymentConcept: true,
          paymentPeriodMonth: true,
          paymentPeriodYear: true,
          transactionDate: true,
          matchSource: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
        },
      });
      if (!existingTx) throw new NotFoundException('Transaction not found');

      const result = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: existingTx.updatedAt,
        },
        data: {
          ...(dto.unitNumber !== undefined && { unitNumberDetected: dto.unitNumber || null }),
          ...(dto.paymentConcept !== undefined && { paymentConcept: dto.paymentConcept || null }),
          ...(dto.paymentPeriodMonth !== undefined && { paymentPeriodMonth: dto.paymentPeriodMonth }),
          ...(dto.paymentPeriodYear !== undefined && { paymentPeriodYear: dto.paymentPeriodYear }),
          ...(dto.transactionDate !== undefined && { transactionDate: new Date(dto.transactionDate) }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(residentId !== undefined && { residentId }),
          matchSource: MatchSource.MANUAL,
          confidenceScore: new Prisma.Decimal('1.0000'),
          matchedAt: new Date(),
          classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
          requiresReviewReason: null,
          matchedRuleId: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      const descriptionForPattern = dto.description ?? existingTx.description;
      if (descriptionForPattern) {
        await tx.reconciliationCorrectionPattern.upsert({
          where: {
            condominiumId_originalDescription: {
              condominiumId,
              originalDescription: descriptionForPattern,
            },
          },
          create: {
            condominiumId,
            originalDescription: descriptionForPattern,
            selectedUnitNumber: dto.unitNumber ?? null,
            selectedResidentId: residentId ?? null,
            selectedConcept: dto.paymentConcept ?? null,
            occurrenceCount: 1,
            lastSeenAt: new Date(),
          },
          update: {
            selectedUnitNumber: dto.unitNumber ?? null,
            selectedResidentId: residentId ?? null,
            selectedConcept: dto.paymentConcept ?? null,
            occurrenceCount: { increment: 1 },
            lastSeenAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_CLASSIFIED_MANUALLY',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: {
            residentId: existingTx.residentId,
            unitNumberDetected: existingTx.unitNumberDetected,
            paymentConcept: existingTx.paymentConcept,
            paymentPeriodMonth: existingTx.paymentPeriodMonth,
            paymentPeriodYear: existingTx.paymentPeriodYear,
            transactionDate: existingTx.transactionDate,
            matchSource: existingTx.matchSource,
            classificationStatus: existingTx.classificationStatus,
            requiresReviewReason: existingTx.requiresReviewReason,
            matchedRuleId: existingTx.matchedRuleId,
          },
          afterState: {
            residentId: residentId ?? existingTx.residentId ?? null,
            unitNumberDetected: dto.unitNumber !== undefined ? (dto.unitNumber || null) : existingTx.unitNumberDetected,
            paymentConcept: dto.paymentConcept !== undefined ? (dto.paymentConcept || null) : existingTx.paymentConcept,
            paymentPeriodMonth: dto.paymentPeriodMonth !== undefined ? dto.paymentPeriodMonth : existingTx.paymentPeriodMonth,
            paymentPeriodYear: dto.paymentPeriodYear !== undefined ? dto.paymentPeriodYear : existingTx.paymentPeriodYear,
            transactionDate: dto.transactionDate !== undefined ? new Date(dto.transactionDate) : existingTx.transactionDate,
            matchSource: MatchSource.MANUAL,
            classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
            requiresReviewReason: null,
            matchedRuleId: null,
          },
          result: 'SUCCESS',
        },
      });
    });
  }

  async unmatch(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          residentId: true,
          matchSource: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
        },
      });
      if (!existing) throw new NotFoundException('Transaction not found');

      const result = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: existing.updatedAt,
        },
        data: {
          residentId: null,
          matchSource: null,
          confidenceScore: null,
          matchedAt: null,
          classificationStatus: ClassificationStatus.NEEDS_REVIEW,
          requiresReviewReason: RequiresReviewReason.NO_MATCH,
          matchedRuleId: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      await tx.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: 'TRANSACTION_UNMATCHED',
          actionCategory: 'CLASSIFICATION',
          module: 'classification',
          entityType: 'Transaction',
          entityId: transactionId,
          beforeState: {
            residentId: existing.residentId,
            matchSource: existing.matchSource,
            classificationStatus: existing.classificationStatus,
            requiresReviewReason: existing.requiresReviewReason,
            matchedRuleId: existing.matchedRuleId,
          },
          afterState: {
            residentId: null,
            matchSource: null,
            classificationStatus: ClassificationStatus.NEEDS_REVIEW,
            requiresReviewReason: RequiresReviewReason.NO_MATCH,
            matchedRuleId: null,
          },
          result: 'SUCCESS',
        },
      });
    });
  }

  private async upsertMonthlySummaries(
    condominiumId: string,
    batchId: string,
  ): Promise<void> {
    const periods = await this.prisma.transaction.groupBy({
      by: ['transactionDate'],
      where: { condominiumId, importBatchId: batchId },
    });

    const uniqueMonths = new Set<string>();
    for (const { transactionDate } of periods) {
      const d = new Date(transactionDate);
      uniqueMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
    }

    await Promise.all(
      Array.from(uniqueMonths).map((key) => {
        const [year, month] = key.split('-').map(Number);
        return this.upsertSummaryForMonth(condominiumId, year, month);
      }),
    );
  }

  private async upsertSummaryForMonth(
    condominiumId: string,
    year: number,
    month: number,
  ): Promise<void> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    // Only APPROVED transactions affect official income/expense totals
    const [incomeAgg, expenseAgg, classificationCounts, reconciliationCounts] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          condominiumId,
          flowType: 'INCOME',
          transactionDate: { gte: start, lt: end },
          reconciliationStatus: ReconciliationStatus.APPROVED,
        },
        _sum: { credits: true },
        _count: true,
      }),
      this.prisma.transaction.aggregate({
        where: {
          condominiumId,
          flowType: 'EXPENSE',
          transactionDate: { gte: start, lt: end },
          reconciliationStatus: ReconciliationStatus.APPROVED,
        },
        _sum: { charges: true },
        _count: true,
      }),
      this.prisma.transaction.groupBy({
        by: ['classificationStatus'],
        where: { condominiumId, transactionDate: { gte: start, lt: end } },
        _count: true,
      }),
      this.prisma.transaction.groupBy({
        by: ['reconciliationStatus'],
        where: { condominiumId, transactionDate: { gte: start, lt: end } },
        _count: true,
      }),
    ]);

    const totalIncome = Number(incomeAgg._sum.credits ?? 0);
    const totalExpenses = Number(expenseAgg._sum.charges ?? 0);
    const approvedCount = incomeAgg._count + expenseAgg._count;

    const totalAll = await this.prisma.transaction.count({
      where: { condominiumId, transactionDate: { gte: start, lt: end } },
    });

    const classifiedCount =
      classificationCounts.find((s) => s.classificationStatus === 'AUTO')?._count ?? 0;
    const needsReviewCount =
      classificationCounts.find((s) => s.classificationStatus === 'NEEDS_REVIEW')?._count ?? 0;

    const pendingCount =
      reconciliationCounts.find((s) => s.reconciliationStatus === 'PENDING')?._count ?? 0;
    const ignoredCount =
      reconciliationCounts.find((s) => s.reconciliationStatus === 'IGNORED')?._count ?? 0;

    const unmatchedRows = await this.prisma.transaction.count({
      where: {
        condominiumId,
        transactionDate: { gte: start, lt: end },
        classificationStatus: 'NEEDS_REVIEW',
        residentId: null,
      },
    });

    await this.prisma.financialMonthlySummary.upsert({
      where: { condominiumId_year_month: { condominiumId, year, month } },
      create: {
        condominiumId,
        year,
        month,
        totalIncome: new Prisma.Decimal(totalIncome.toFixed(2)),
        totalExpenses: new Prisma.Decimal(totalExpenses.toFixed(2)),
        netBalance: new Prisma.Decimal((totalIncome - totalExpenses).toFixed(2)),
        transactionCount: totalAll,
        classifiedCount,
        needsReviewCount,
        unmatchedCount: unmatchedRows,
        approvedCount,
        pendingCount,
        ignoredCount,
      },
      update: {
        totalIncome: new Prisma.Decimal(totalIncome.toFixed(2)),
        totalExpenses: new Prisma.Decimal(totalExpenses.toFixed(2)),
        netBalance: new Prisma.Decimal((totalIncome - totalExpenses).toFixed(2)),
        transactionCount: totalAll,
        classifiedCount,
        needsReviewCount,
        unmatchedCount: unmatchedRows,
        approvedCount,
        pendingCount,
        ignoredCount,
      },
    });
  }

  async approveTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId },
      select: {
        transactionDate: true,
        reconciliationStatus: true,
        matchedCalendarEventId: true,
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const before = { reconciliationStatus: tx.reconciliationStatus };
    const now = new Date();

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: ReconciliationStatus.APPROVED,
        reconciledById: userId,
        reconciledAt: now,
      },
    });

    const d = new Date(tx.transactionDate);
    await this.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);

    // When a terrace booking was linked, mark it as PAID on approval.
    if (tx.matchedCalendarEventId) {
      await this.markTerraceEventPaid(tx.matchedCalendarEventId, transactionId, condominiumId, userId);
    }

    await this.prisma.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: 'TRANSACTION_APPROVED',
        actionCategory: 'RECONCILIATION',
        module: 'transactions',
        entityType: 'Transaction',
        entityId: transactionId,
        beforeState: before,
        afterState: { reconciliationStatus: ReconciliationStatus.APPROVED },
        result: 'SUCCESS',
      },
    });
  }

  private async markTerraceEventPaid(
    calendarEventId: string,
    transactionId: string,
    condominiumId: string,
    userId: string,
  ): Promise<void> {
    const ev = await this.prisma.calendarEvent.findFirst({
      where: { id: calendarEventId, condominiumId, deletedAt: null },
      select: { metadata: true },
    });
    if (!ev) {
      this.logger.warn(
        `markTerraceEventPaid: event ${calendarEventId} not found or deleted — skipping payment status update`,
      );
      return;
    }

    const validation = validateTerraceMetadata(ev.metadata);
    if (!validation.valid) {
      this.logger.warn(
        `markTerraceEventPaid: corrupt metadata on event ${calendarEventId} — ${validation.error}`,
      );
      return;
    }
    if (validation.data.paymentStatus === 'PAID') {
      this.logger.debug(
        `markTerraceEventPaid: event ${calendarEventId} already PAID — skipping`,
      );
      return;
    }

    const updatedMetadata = { ...validation.data, paymentStatus: 'PAID' as const };

    await this.prisma.calendarEvent.update({
      where: { id: calendarEventId },
      data: { metadata: updatedMetadata as unknown as Prisma.InputJsonValue },
    });

    await this.prisma.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: 'TERRACE_BOOKING_MARKED_PAID',
        actionCategory: 'RECONCILIATION',
        module: 'calendar',
        entityType: 'CalendarEvent',
        entityId: calendarEventId,
        beforeState: { paymentStatus: validation.data.paymentStatus },
        afterState: { paymentStatus: 'PAID', linkedTransactionId: transactionId },
        result: 'SUCCESS',
        description: `Terrace booking payment confirmed via transaction ${transactionId}`,
      },
    });
  }

  async ignoreTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const before = { reconciliationStatus: tx.reconciliationStatus };
    const now = new Date();

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: ReconciliationStatus.IGNORED,
        reconciledById: userId,
        reconciledAt: now,
      },
    });

    const d = new Date(tx.transactionDate);
    await this.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);

    await this.prisma.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: 'TRANSACTION_IGNORED',
        actionCategory: 'RECONCILIATION',
        module: 'transactions',
        entityType: 'Transaction',
        entityId: transactionId,
        beforeState: before,
        afterState: { reconciliationStatus: ReconciliationStatus.IGNORED },
        result: 'SUCCESS',
      },
    });
  }

  async reopenTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const before = { reconciliationStatus: tx.reconciliationStatus };

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: ReconciliationStatus.PENDING,
        reconciledById: null,
        reconciledAt: null,
      },
    });

    const d = new Date(tx.transactionDate);
    await this.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);

    await this.prisma.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: 'TRANSACTION_REOPENED',
        actionCategory: 'RECONCILIATION',
        module: 'transactions',
        entityType: 'Transaction',
        entityId: transactionId,
        beforeState: before,
        afterState: { reconciliationStatus: ReconciliationStatus.PENDING },
        result: 'SUCCESS',
      },
    });
  }

  async bulkReconcile(
    condominiumId: string,
    ids: string[],
    action: 'approve' | 'ignore' | 'reopen',
    userId: string,
  ): Promise<{ affected: number }> {
    // Verify all IDs belong to this condominium (IDOR protection)
    const existing = await this.prisma.transaction.findMany({
      where: { id: { in: ids }, condominiumId },
      select: { id: true, transactionDate: true, reconciliationStatus: true },
    });

    if (existing.length !== ids.length) {
      throw new ForbiddenException('One or more transactions do not belong to this condominium');
    }

    const statusMap: Record<string, ReconciliationStatus> = {
      approve: ReconciliationStatus.APPROVED,
      ignore: ReconciliationStatus.IGNORED,
      reopen: ReconciliationStatus.PENDING,
    };
    const newStatus = statusMap[action];
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.transaction.updateMany({
        where: { id: { in: ids }, condominiumId },
        data: {
          reconciliationStatus: newStatus,
          reconciledById: action === 'reopen' ? null : userId,
          reconciledAt: action === 'reopen' ? null : now,
        },
      }),
    ]);

    // Recalculate summaries for all affected months
    const uniqueMonths = new Set<string>();
    for (const tx of existing) {
      const d = new Date(tx.transactionDate);
      uniqueMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
    }
    await Promise.all(
      Array.from(uniqueMonths).map((key) => {
        const [year, month] = key.split('-').map(Number);
        return this.upsertSummaryForMonth(condominiumId, year, month);
      }),
    );

    const actionMap: Record<string, string> = {
      approve: 'TRANSACTIONS_BULK_APPROVED',
      ignore: 'TRANSACTIONS_BULK_IGNORED',
      reopen: 'TRANSACTIONS_BULK_REOPENED',
    };

    await this.prisma.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: actionMap[action],
        actionCategory: 'RECONCILIATION',
        module: 'transactions',
        afterState: { ids, newStatus, count: ids.length },
        result: 'SUCCESS',
        description: `Bulk ${action}: ${ids.length} transactions`,
      },
    });

    return { affected: ids.length };
  }
}
