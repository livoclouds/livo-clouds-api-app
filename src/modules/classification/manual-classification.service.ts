// Manual classification operations (ENGINE-008 decomposition, Phase 6).
// manualMatch / manualClassify (incl. the multi-unit allocation split) /
// unmatch, with their optimistic-lock guards, correction-pattern learning and
// audit logs. Extracted verbatim from ClassificationService.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MatchSource, ClassificationStatus, RequiresReviewReason, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsCacheService } from '../settings/settings-cache.service';
import { round2, toCents } from '../../common/utils/money.util';

@Injectable()
export class ManualClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsCache: SettingsCacheService,
  ) {}

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
      throw new NotFoundException('Resident not found in this condominium');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          residentId: true,
          matchSource: true,
          matchedPatternLabel: true,
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
          matchedPatternLabel: null,
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

      // A single-resident link supersedes any prior multi-unit split; stale
      // allocations would keep paying the old residents (ENGINE-006).
      await tx.paymentAllocation.deleteMany({
        where: { transactionId, condominiumId },
      });

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
            // ENGINE-042: keep the pattern attribution in the audit trail so the
            // metrics service can slice override rates per pattern.
            matchedPatternLabel: existing.matchedPatternLabel,
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
      allocations?: {
        unitNumber: string;
        residentId: string;
        allocatedAmount: number;
      }[];
      paymentConcept?: string;
      expenseCategoryId?: string;
      supplierId?: string;
      paymentPeriodMonth?: number;
      paymentPeriodYear?: number;
      transactionDate?: string;
      description?: string;
    },
    userId: string,
  ): Promise<void> {
    // Multi-house payment: split the credit across several units via
    // PaymentAllocation rows instead of a single resident link.
    if (dto.allocations && dto.allocations.length > 0) {
      return this.manualClassifyWithAllocations(condominiumId, transactionId, dto, userId);
    }

    // REV-004: strict resident resolution.
    // `residentId === undefined` means the dto did not touch the unit (no update),
    // `null` means admin explicitly cleared the unit, a string means resolved match.
    // An unresolved non-empty unitNumber raises 400 UNIT_NOT_FOUND so admin typos
    // never silently break a correctly matched transaction.
    let residentId: string | null | undefined;
    if (dto.unitNumber === '') {
      residentId = null;
    } else if (dto.unitNumber) {
      const resident = await this.prisma.resident.findFirst({
        where: { condominiumId, unitNumber: dto.unitNumber, deletedAt: null },
        select: { id: true },
      });
      if (!resident) {
        throw new BadRequestException({
          code: 'UNIT_NOT_FOUND',
          reason: `Unit "${dto.unitNumber}" does not match any resident in this condominium.`,
          field: 'unitNumber',
          unitNumber: dto.unitNumber,
        });
      }
      residentId = resident.id;
    }

    // Tenant-scope guard: a category/supplier id, when provided non-empty, must
    // belong to this condominium before it can be stamped on the transaction.
    if (dto.expenseCategoryId) {
      const cat = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.expenseCategoryId, condominiumId, deletedAt: null },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException({
          code: 'EXPENSE_CATEGORY_NOT_FOUND',
          reason: 'Expense category does not belong to this condominium.',
          field: 'expenseCategoryId',
        });
      }
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, condominiumId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException({
          code: 'SUPPLIER_NOT_FOUND',
          reason: 'Supplier does not belong to this condominium.',
          field: 'supplierId',
        });
      }
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
          expenseCategoryId: true,
          supplierId: true,
          paymentPeriodMonth: true,
          paymentPeriodYear: true,
          transactionDate: true,
          matchSource: true,
          matchedPatternLabel: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
          paymentAllocations: {
            select: { residentId: true, unitNumber: true, allocatedAmount: true },
          },
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
          // ENGINE-021: the scalar/array pair moves together — a single-unit
          // re-link must not leave a stale multi-unit array behind (the DB
          // CHECK constraint now enforces this invariant structurally).
          ...(dto.unitNumber !== undefined && {
            unitNumberDetected: dto.unitNumber || null,
            unitNumbersDetected: dto.unitNumber ? [dto.unitNumber] : [],
          }),
          ...(dto.paymentConcept !== undefined && { paymentConcept: dto.paymentConcept || null }),
          ...(dto.expenseCategoryId !== undefined && { expenseCategoryId: dto.expenseCategoryId || null }),
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId || null }),
          ...(dto.paymentPeriodMonth !== undefined && { paymentPeriodMonth: dto.paymentPeriodMonth }),
          ...(dto.paymentPeriodYear !== undefined && { paymentPeriodYear: dto.paymentPeriodYear }),
          ...(dto.transactionDate !== undefined && { transactionDate: new Date(dto.transactionDate) }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(residentId !== undefined && { residentId }),
          matchSource: MatchSource.MANUAL,
          matchedPatternLabel: null,
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

      // Re-linking to a single unit supersedes any prior multi-unit split.
      // Concept/period-only edits (unitNumber undefined) must NOT touch a
      // valid split — only linkage rewrites clean up (ENGINE-006).
      if (dto.unitNumber !== undefined) {
        await tx.paymentAllocation.deleteMany({
          where: { transactionId, condominiumId },
        });
      }

      const descriptionForPattern = dto.description ?? existingTx.description;
      // ENGINE-043 hygiene: only record corrections that carry an outcome the
      // learned-correction pass can re-apply. A concept/period-only edit with
      // no unit/resident/concept would mint an empty pattern that can never fire.
      const hasLearnableOutcome =
        (dto.unitNumber !== undefined && dto.unitNumber !== '') ||
        (residentId !== undefined && residentId !== null) ||
        (dto.paymentConcept !== undefined && dto.paymentConcept !== '');
      if (descriptionForPattern && hasLearnableOutcome) {
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
            expenseCategoryId: existingTx.expenseCategoryId,
            supplierId: existingTx.supplierId,
            paymentPeriodMonth: existingTx.paymentPeriodMonth,
            paymentPeriodYear: existingTx.paymentPeriodYear,
            transactionDate: existingTx.transactionDate,
            matchSource: existingTx.matchSource,
            // ENGINE-042: pattern attribution survives in the audit trail.
            matchedPatternLabel: existingTx.matchedPatternLabel,
            classificationStatus: existingTx.classificationStatus,
            requiresReviewReason: existingTx.requiresReviewReason,
            matchedRuleId: existingTx.matchedRuleId,
            // Splits removed by a single-unit re-link (ENGINE-006 cleanup).
            ...(dto.unitNumber !== undefined &&
              (existingTx.paymentAllocations?.length ?? 0) > 0 && {
                removedAllocations: existingTx.paymentAllocations.map((a) => ({
                  residentId: a.residentId,
                  unitNumber: a.unitNumber,
                  allocatedAmount: Number(a.allocatedAmount),
                })),
              }),
          },
          afterState: {
            residentId: residentId !== undefined ? residentId : (existingTx.residentId ?? null),
            unitNumberDetected: dto.unitNumber !== undefined ? (dto.unitNumber || null) : existingTx.unitNumberDetected,
            // ENGINE-021: array kept in lockstep with the scalar above.
            ...(dto.unitNumber !== undefined && {
              unitNumbersDetected: dto.unitNumber ? [dto.unitNumber] : [],
            }),
            paymentConcept: dto.paymentConcept !== undefined ? (dto.paymentConcept || null) : existingTx.paymentConcept,
            expenseCategoryId: dto.expenseCategoryId !== undefined ? (dto.expenseCategoryId || null) : existingTx.expenseCategoryId,
            supplierId: dto.supplierId !== undefined ? (dto.supplierId || null) : existingTx.supplierId,
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

  /**
   * Splits a single credit across several houses (PaymentAllocation rows). Used
   * for BanBajío payments whose concept names more than one unit ("casas 307 y
   * 43"). The transaction itself keeps no single residentId — each resident is
   * credited their slice via an allocation, and per-resident balances read those
   * allocations (see CollectionService.getAccountStatement). Re-editing replaces
   * the prior allocations wholesale (delete-and-recreate) so it stays idempotent.
   */
  private async manualClassifyWithAllocations(
    condominiumId: string,
    transactionId: string,
    dto: {
      allocations?: {
        unitNumber: string;
        residentId: string;
        allocatedAmount: number;
      }[];
      paymentConcept?: string;
      paymentPeriodMonth?: number;
      paymentPeriodYear?: number;
      transactionDate?: string;
      description?: string;
    },
    userId: string,
  ): Promise<void> {
    const allocations = dto.allocations ?? [];
    const settings = await this.settingsCache.getSettings(condominiumId);
    const totalUnits = settings?.totalUnits ?? 0;

    await this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          updatedAt: true,
          description: true,
          credits: true,
          residentId: true,
          unitNumberDetected: true,
          unitNumbersDetected: true,
          paymentConcept: true,
          paymentPeriodMonth: true,
          paymentPeriodYear: true,
          transactionDate: true,
          matchSource: true,
          classificationStatus: true,
          requiresReviewReason: true,
          matchedRuleId: true,
          paymentAllocations: {
            select: { unitNumber: true, residentId: true, allocatedAmount: true },
          },
        },
      });
      if (!existingTx) throw new NotFoundException('Transaction not found');

      const credit = existingTx.credits ? Number(existingTx.credits) : 0;
      if (credit <= 0) {
        throw new BadRequestException({
          code: 'ALLOCATION_NOT_INCOME',
          reason: 'Only an income transaction with a credit amount can be split across units.',
        });
      }

      // Amounts must sum to the credit EXACTLY, compared in integer cents
      // (ENGINE-052: the previous ±$0.01 tolerance persisted one-cent drifts).
      const sumCents = allocations.reduce(
        (acc, a) => acc + toCents(Number(a.allocatedAmount)),
        0,
      );
      const sum = sumCents / 100;
      if (sumCents !== toCents(credit)) {
        throw new BadRequestException({
          code: 'ALLOCATION_SUM_MISMATCH',
          reason: `Allocations must sum to the transaction credit (${credit.toFixed(2)}); got ${sum.toFixed(2)}.`,
          field: 'allocations',
          expected: credit,
          received: sum,
        });
      }

      // Each unit must be in range and each resident must actually live in it.
      for (const a of allocations) {
        const n = parseInt(a.unitNumber, 10);
        if (!Number.isFinite(n) || n < 1 || totalUnits <= 0 || n > totalUnits) {
          throw new BadRequestException({
            code: 'ALLOCATION_UNIT_OUT_OF_RANGE',
            reason: `Unit "${a.unitNumber}" is outside the configured range (1..${totalUnits}).`,
            field: 'allocations',
            unitNumber: a.unitNumber,
          });
        }
        const resident = await tx.resident.findFirst({
          where: { id: a.residentId, condominiumId, unitNumber: a.unitNumber, deletedAt: null },
          select: { id: true },
        });
        if (!resident) {
          throw new BadRequestException({
            code: 'ALLOCATION_RESIDENT_UNIT_MISMATCH',
            reason: `Resident does not match unit "${a.unitNumber}" in this condominium.`,
            field: 'allocations',
            unitNumber: a.unitNumber,
            residentId: a.residentId,
          });
        }
      }

      const periodMonth = dto.paymentPeriodMonth ?? existingTx.paymentPeriodMonth;
      const periodYear = dto.paymentPeriodYear ?? existingTx.paymentPeriodYear;
      const txDate = dto.transactionDate ? new Date(dto.transactionDate) : existingTx.transactionDate;
      const units = allocations.map((a) => a.unitNumber);

      const result = await tx.transaction.updateMany({
        where: { id: transactionId, condominiumId, updatedAt: existingTx.updatedAt },
        data: {
          // No single resident owns a split payment; the array carries the houses.
          residentId: null,
          unitNumberDetected: null,
          unitNumbersDetected: units,
          ...(dto.paymentConcept !== undefined && { paymentConcept: dto.paymentConcept || null }),
          ...(dto.paymentPeriodMonth !== undefined && { paymentPeriodMonth: dto.paymentPeriodMonth }),
          ...(dto.paymentPeriodYear !== undefined && { paymentPeriodYear: dto.paymentPeriodYear }),
          ...(dto.transactionDate !== undefined && { transactionDate: new Date(dto.transactionDate) }),
          ...(dto.description !== undefined && { description: dto.description }),
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

      // Delete-and-recreate keeps re-edits idempotent.
      await tx.paymentAllocation.deleteMany({ where: { transactionId } });
      await tx.paymentAllocation.createMany({
        data: allocations.map((a) => ({
          condominiumId,
          transactionId,
          residentId: a.residentId,
          unitNumber: a.unitNumber,
          paymentPeriodYear: periodYear ?? txDate.getUTCFullYear(),
          paymentPeriodMonth: periodMonth ?? txDate.getUTCMonth() + 1,
          allocatedAmount: new Prisma.Decimal(round2(Number(a.allocatedAmount)).toFixed(2)),
        })),
      });

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
            unitNumbersDetected: existingTx.unitNumbersDetected,
            classificationStatus: existingTx.classificationStatus,
            allocations: existingTx.paymentAllocations.map((a) => ({
              unitNumber: a.unitNumber,
              residentId: a.residentId,
              allocatedAmount: Number(a.allocatedAmount),
            })),
          },
          afterState: {
            residentId: null,
            unitNumberDetected: null,
            unitNumbersDetected: units,
            classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
            allocations: allocations.map((a) => ({
              unitNumber: a.unitNumber,
              residentId: a.residentId,
              allocatedAmount: Number(a.allocatedAmount),
            })),
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
          matchedPatternLabel: true,
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
          matchedPatternLabel: null,
          confidenceScore: null,
          matchedAt: null,
          classificationStatus: ClassificationStatus.NEEDS_REVIEW,
          requiresReviewReason: RequiresReviewReason.MANUAL_UNMATCHED,
          matchedRuleId: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      // Unlinked means zero allocations — a surviving split would keep paying
      // residents out of a transaction that belongs to no one (ENGINE-006).
      await tx.paymentAllocation.deleteMany({
        where: { transactionId, condominiumId },
      });

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
            // ENGINE-042: pattern attribution survives in the audit trail.
            matchedPatternLabel: existing.matchedPatternLabel,
            classificationStatus: existing.classificationStatus,
            requiresReviewReason: existing.requiresReviewReason,
            matchedRuleId: existing.matchedRuleId,
          },
          afterState: {
            residentId: null,
            matchSource: null,
            classificationStatus: ClassificationStatus.NEEDS_REVIEW,
            requiresReviewReason: RequiresReviewReason.MANUAL_UNMATCHED,
            matchedRuleId: null,
          },
          result: 'SUCCESS',
        },
      });
    });
  }
}
