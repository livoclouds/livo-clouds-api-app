import { Injectable } from '@nestjs/common';
import { MatchSource, ClassificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface ResidentData {
  id: string;
  unitNumber: string;
  firstName: string;
  lastName: string;
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
    if (normalized.includes(name)) {
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

function matchToResident(
  extraction: TextExtraction,
  residents: ResidentData[],
): MatchResult {
  // Pass 1: exact unit number match
  if (extraction.unitNumberDetected) {
    const normalizedDetected = normalizeText(extraction.unitNumberDetected);
    const found = residents.find(
      (r) => normalizeText(r.unitNumber) === normalizedDetected,
    );
    if (found) {
      const score = extraction.unitConfidence;
      return {
        residentId: score >= 0.8 ? found.id : null,
        matchSource: MatchSource.AUTO_UNIT_NUMBER,
        confidenceScore: score,
        classificationStatus:
          score >= 0.8
            ? ClassificationStatus.AUTO
            : ClassificationStatus.NEEDS_REVIEW,
        matchedAt: score >= 0.8 ? new Date() : null,
      };
    }
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
      const status =
        multipleMatches || bestScore < 0.8
          ? ClassificationStatus.NEEDS_REVIEW
          : ClassificationStatus.AUTO;
      return {
        residentId: status === ClassificationStatus.AUTO ? bestResident.id : null,
        matchSource: MatchSource.AUTO_NAME,
        confidenceScore: bestScore,
        classificationStatus: status,
        matchedAt: status === ClassificationStatus.AUTO ? new Date() : null,
      };
    }
  }

  // Pass 3: no match
  return {
    residentId: null,
    matchSource: null,
    confidenceScore: 0,
    classificationStatus: ClassificationStatus.NEEDS_REVIEW,
    matchedAt: null,
  };
}

@Injectable()
export class ClassificationService {
  constructor(private readonly prisma: PrismaService) {}

  classifyTransaction(
    description: string,
    residents: ResidentData[],
  ): ClassificationResult {
    const extraction = extractFromText(description);
    const match = matchToResident(extraction, residents);
    return { ...extraction, ...match };
  }

  async classifyBatch(
    condominiumId: string,
    batchId: string,
  ): Promise<ClassificationSummary> {
    const [residents, transactions] = await Promise.all([
      this.prisma.resident.findMany({
        where: { condominiumId, deletedAt: null },
        select: { id: true, unitNumber: true, firstName: true, lastName: true },
      }),
      this.prisma.transaction.findMany({
        where: { condominiumId, importBatchId: batchId },
        select: { id: true, description: true, transactionDate: true, credits: true, charges: true, flowType: true },
      }),
    ]);

    let classified = 0;
    let needsReview = 0;
    let unmatched = 0;

    const CHUNK = 200;
    for (let i = 0; i < transactions.length; i += CHUNK) {
      const chunk = transactions.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (tx) => {
          const result = this.classifyTransaction(tx.description, residents);
          await this.prisma.transaction.update({
            where: { id: tx.id },
            data: {
              unitNumberDetected: result.unitNumberDetected,
              payerNameDetected: result.payerNameDetected,
              paymentConcept: result.paymentConcept,
              paymentPeriodYear: result.paymentPeriodYear,
              paymentPeriodMonth: result.paymentPeriodMonth,
              matchSource: result.matchSource,
              confidenceScore: result.confidenceScore
                ? new Prisma.Decimal(result.confidenceScore.toFixed(4))
                : null,
              matchedAt: result.matchedAt,
              residentId: result.residentId,
              classificationStatus: result.classificationStatus,
            },
          });

          if (result.classificationStatus === ClassificationStatus.AUTO) {
            classified++;
          } else {
            needsReview++;
            if (!result.residentId) unmatched++;
          }
        }),
      );
    }

    await this.upsertMonthlySummaries(condominiumId, batchId);

    return { total: transactions.length, classified, needsReview, unmatched };
  }

  async reclassifyBatch(
    condominiumId: string,
    batchId: string,
  ): Promise<ClassificationSummary> {
    await this.prisma.transaction.updateMany({
      where: { condominiumId, importBatchId: batchId },
      data: {
        classificationStatus: ClassificationStatus.NEEDS_REVIEW,
        residentId: null,
        matchSource: null,
        confidenceScore: null,
        matchedAt: null,
        classificationVersion: { increment: 1 },
      },
    });
    return this.classifyBatch(condominiumId, batchId);
  }

  async manualMatch(
    condominiumId: string,
    transactionId: string,
    residentId: string,
  ): Promise<void> {
    const resident = await this.prisma.resident.findFirst({
      where: { id: residentId, condominiumId, deletedAt: null },
    });
    if (!resident) {
      throw new Error('Resident not found in this condominium');
    }
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        residentId,
        matchSource: MatchSource.MANUAL,
        confidenceScore: new Prisma.Decimal('1.0000'),
        matchedAt: new Date(),
        classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
      },
    });
  }

  async unmatch(condominiumId: string, transactionId: string): Promise<void> {
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        residentId: null,
        matchSource: null,
        confidenceScore: null,
        matchedAt: null,
        classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      },
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
      Array.from(uniqueMonths).map(async (key) => {
        const [year, month] = key.split('-').map(Number);
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 1);

        const [incomeAgg, expenseAgg, statusCounts] = await Promise.all([
          this.prisma.transaction.aggregate({
            where: { condominiumId, flowType: 'INCOME', transactionDate: { gte: start, lt: end } },
            _sum: { credits: true },
            _count: true,
          }),
          this.prisma.transaction.aggregate({
            where: { condominiumId, flowType: 'EXPENSE', transactionDate: { gte: start, lt: end } },
            _sum: { charges: true },
            _count: true,
          }),
          this.prisma.transaction.groupBy({
            by: ['classificationStatus'],
            where: { condominiumId, transactionDate: { gte: start, lt: end } },
            _count: true,
          }),
        ]);

        const totalIncome = Number(incomeAgg._sum.credits ?? 0);
        const totalExpenses = Number(expenseAgg._sum.charges ?? 0);
        const transactionCount = incomeAgg._count + expenseAgg._count;
        const classifiedCount =
          statusCounts.find((s) => s.classificationStatus === 'AUTO')?._count ?? 0;
        const needsReviewCount =
          statusCounts.find((s) => s.classificationStatus === 'NEEDS_REVIEW')?._count ?? 0;

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
            transactionCount,
            classifiedCount,
            needsReviewCount,
            unmatchedCount: unmatchedRows,
          },
          update: {
            totalIncome: new Prisma.Decimal(totalIncome.toFixed(2)),
            totalExpenses: new Prisma.Decimal(totalExpenses.toFixed(2)),
            netBalance: new Prisma.Decimal((totalIncome - totalExpenses).toFixed(2)),
            transactionCount,
            classifiedCount,
            needsReviewCount,
            unmatchedCount: unmatchedRows,
          },
        });
      }),
    );
  }
}
