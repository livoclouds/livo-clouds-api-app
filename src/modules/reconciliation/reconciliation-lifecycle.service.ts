// Reconciliation lifecycle (ENGINE-008/ENGINE-040 decomposition, Phase 6).
// approve / ignore / reopen / bulk-reconcile with their guarded state
// transitions, terrace side effects and audit logs — extracted verbatim from
// ClassificationService. URL surface and response shapes are unchanged; the
// routes now live on ReconciliationController.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ReconciliationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SummaryRecomputeService } from './summary-recompute.service';
import { TerracePaymentLinkService } from './terrace-payment-link.service';

@Injectable()
export class ReconciliationLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummaryRecomputeService,
    private readonly terraceLinks: TerracePaymentLinkService,
  ) {}

  // ENGINE-020: approve mirrors reopen's guarded pattern — explicit
  // state-transition check (only PENDING rows can be approved), optimistic
  // lock on updatedAt, and all side effects (terrace marking, audit log)
  // inside one transaction. The summary recompute stays post-commit: it is
  // derived data, recomputable, and serialized by its own advisory lock.
  async approveTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    let capturedDate: Date | undefined;

    await this.prisma.$transaction(async (prisma) => {
      const tx = await prisma.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          transactionDate: true,
          reconciliationStatus: true,
          matchedCalendarEventId: true,
          updatedAt: true,
        },
      });
      if (!tx) throw new NotFoundException('Transaction not found');

      if (tx.reconciliationStatus !== ReconciliationStatus.PENDING) {
        throw new BadRequestException({
          code: 'INVALID_STATE_TRANSITION',
          reason: `Transaction is ${tx.reconciliationStatus} — reopen it before changing its reconciliation outcome.`,
        });
      }

      capturedDate = tx.transactionDate;
      const before = { reconciliationStatus: tx.reconciliationStatus };
      const now = new Date();

      const result = await prisma.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: tx.updatedAt,
          reconciliationStatus: ReconciliationStatus.PENDING,
        },
        data: {
          reconciliationStatus: ReconciliationStatus.APPROVED,
          reconciledById: userId,
          reconciledAt: now,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      // When a terrace booking was linked, mark it as PAID on approval.
      if (tx.matchedCalendarEventId) {
        await this.terraceLinks.markTerraceEventPaid(
          tx.matchedCalendarEventId,
          transactionId,
          condominiumId,
          userId,
          prisma,
        );
      }

      await prisma.auditLog.create({
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
    });

    const d = new Date(capturedDate!);
    await this.summaries.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);
  }

  // ENGINE-020: ignore is guarded exactly like approve — APPROVED→IGNORED
  // without an intermediate reopen returns INVALID_STATE_TRANSITION, and a
  // concurrent edit surfaces as STALE_OVERRIDE instead of last-write-wins.
  async ignoreTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    let capturedDate: Date | undefined;

    await this.prisma.$transaction(async (prisma) => {
      const tx = await prisma.transaction.findFirst({
        where: { id: transactionId, condominiumId },
        select: {
          transactionDate: true,
          reconciliationStatus: true,
          updatedAt: true,
        },
      });
      if (!tx) throw new NotFoundException('Transaction not found');

      if (tx.reconciliationStatus !== ReconciliationStatus.PENDING) {
        throw new BadRequestException({
          code: 'INVALID_STATE_TRANSITION',
          reason: `Transaction is ${tx.reconciliationStatus} — reopen it before changing its reconciliation outcome.`,
        });
      }

      capturedDate = tx.transactionDate;
      const before = { reconciliationStatus: tx.reconciliationStatus };
      const now = new Date();

      const result = await prisma.transaction.updateMany({
        where: {
          id: transactionId,
          condominiumId,
          updatedAt: tx.updatedAt,
          reconciliationStatus: ReconciliationStatus.PENDING,
        },
        data: {
          reconciliationStatus: ReconciliationStatus.IGNORED,
          reconciledById: userId,
          reconciledAt: now,
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      await prisma.auditLog.create({
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
    });

    const d = new Date(capturedDate!);
    await this.summaries.upsertSummaryForMonth(condominiumId, d.getUTCFullYear(), d.getUTCMonth() + 1);
  }

  async reopenTransaction(
    condominiumId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    let capturedDate: Date | undefined;
    let capturedCalendarEventId: string | null | undefined;

    await this.prisma.$transaction(async (prisma) => {
      const tx = await prisma.transaction.findFirst({
        where: { id: transactionId, condominiumId },
      });
      if (!tx) throw new NotFoundException('Transaction not found');

      if (tx.reconciliationStatus === ReconciliationStatus.PENDING) {
        throw new BadRequestException({
          code: 'INVALID_STATE_TRANSITION',
          reason: 'Transaction is already PENDING and cannot be reopened.',
        });
      }

      capturedDate = tx.transactionDate;
      capturedCalendarEventId = tx.matchedCalendarEventId;
      const before = { reconciliationStatus: tx.reconciliationStatus };

      const result = await prisma.transaction.updateMany({
        where: { id: transactionId, condominiumId, updatedAt: tx.updatedAt },
        data: {
          reconciliationStatus: ReconciliationStatus.PENDING,
          reconciledById: null,
          reconciledAt: null,
        },
      });

      if (result.count === 0) {
        throw new ConflictException({
          code: 'STALE_OVERRIDE',
          reason: 'Transaction was modified by another user. Refresh and try again.',
        });
      }

      await prisma.auditLog.create({
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
    });

    const d = new Date(capturedDate!);
    await this.summaries.recomputeMonths(condominiumId, [
      `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`,
    ]);

    if (capturedCalendarEventId) {
      await this.terraceLinks.unmarkTerraceEventPaid(capturedCalendarEventId, transactionId, condominiumId, userId);
    }
  }

  // ENGINE-019: the bulk write asserts the expected current status (a bulk
  // approve no longer silently overrides a fresh IGNORE), terrace bookings
  // are marked PAID on bulk approve (parity with single approve), and every
  // side effect — terrace marking/revert, audit log — runs inside the same
  // transaction so a late failure rolls the whole batch back. Rows that
  // changed status concurrently are skipped and reported, not overwritten.
  async bulkReconcile(
    condominiumId: string,
    ids: string[],
    action: 'approve' | 'ignore' | 'reopen',
    userId: string,
  ): Promise<{ affected: number; skipped: number; requested: number }> {
    // Verify all IDs belong to this condominium (IDOR protection)
    const existing = await this.prisma.transaction.findMany({
      where: { id: { in: ids }, condominiumId },
      select: { id: true, transactionDate: true },
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

    // approve/ignore only act on PENDING rows; reopen only on settled ones.
    const statusPrecondition =
      action === 'reopen'
        ? { not: ReconciliationStatus.PENDING }
        : ReconciliationStatus.PENDING;

    const actionMap: Record<string, string> = {
      approve: 'TRANSACTIONS_BULK_APPROVED',
      ignore: 'TRANSACTIONS_BULK_IGNORED',
      reopen: 'TRANSACTIONS_BULK_REOPENED',
    };

    let affected = 0;

    await this.prisma.$transaction(async (prisma) => {
      // Re-read eligibility inside the transaction so the terrace side
      // effects below act on the same row set the guarded write touches.
      const eligible = await prisma.transaction.findMany({
        where: { id: { in: ids }, condominiumId, reconciliationStatus: statusPrecondition },
        select: { id: true, reconciliationStatus: true, matchedCalendarEventId: true },
      });

      const result = await prisma.transaction.updateMany({
        where: {
          id: { in: eligible.map((t) => t.id) },
          condominiumId,
          reconciliationStatus: statusPrecondition,
        },
        data: {
          reconciliationStatus: newStatus,
          reconciledById: action === 'reopen' ? null : userId,
          reconciledAt: action === 'reopen' ? null : now,
        },
      });
      affected = result.count;

      if (action === 'approve') {
        // Terrace parity with single approve (ENGINE-019): linked bookings
        // are marked PAID in the same transaction as the approval.
        for (const t of eligible) {
          if (t.matchedCalendarEventId) {
            await this.terraceLinks.markTerraceEventPaid(
              t.matchedCalendarEventId,
              t.id,
              condominiumId,
              userId,
              prisma,
            );
          }
        }
      }

      if (action === 'reopen') {
        for (const t of eligible) {
          if (
            t.matchedCalendarEventId &&
            t.reconciliationStatus === ReconciliationStatus.APPROVED
          ) {
            await this.terraceLinks.unmarkTerraceEventPaid(
              t.matchedCalendarEventId,
              t.id,
              condominiumId,
              userId,
              prisma,
            );
          }
        }
      }

      await prisma.auditLog.create({
        data: {
          condominiumId,
          userId,
          action: actionMap[action],
          actionCategory: 'RECONCILIATION',
          module: 'transactions',
          afterState: {
            ids,
            newStatus,
            requested: ids.length,
            affected,
            skipped: ids.length - affected,
          },
          result: 'SUCCESS',
          description: `Bulk ${action}: ${affected} of ${ids.length} transactions`,
        },
      });
    });

    // Recalculate summaries for all affected months (deduped, sequential).
    // Post-commit like the single-row paths: derived data behind its own
    // advisory lock, recomputable if this step fails.
    await this.summaries.recomputeMonths(
      condominiumId,
      existing.map((tx) => {
        const d = new Date(tx.transactionDate);
        return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
      }),
    );

    return { affected, skipped: ids.length - affected, requested: ids.length };
  }
}
