// Terrace-booking payment links (ENGINE-008 decomposition, Phase 6). Marks a
// linked TERRACE_BOOKING event PAID on approval and reverts it on reopen /
// batch delete. Extracted verbatim from ClassificationService.
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ReconciliationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { validateTerraceMetadata } from '../calendar/terrace-metadata.validator';

@Injectable()
export class TerracePaymentLinkService {
  private readonly logger = new Logger(TerracePaymentLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ENGINE-002 — revert terrace bookings marked PAID by transactions of the
  // given batch. Called by imports remove() before hard-deleting the rows so
  // a booking never stays PAID with its proof transaction gone.
  async revertTerraceLinksForBatch(
    condominiumId: string,
    batchId: string,
    userId: string,
  ): Promise<void> {
    const linked = await this.prisma.transaction.findMany({
      where: {
        condominiumId,
        importBatchId: batchId,
        matchedCalendarEventId: { not: null },
      },
      select: { id: true, matchedCalendarEventId: true },
    });
    // CAL-005: all rows of this batch are about to be hard-deleted together, so a
    // sibling row must not count as "still covering" a booking when deciding
    // whether to revert it — pass the whole batch as the exclusion set.
    const batchTransactionIds = linked.map((tx) => tx.id);
    for (const tx of linked) {
      if (!tx.matchedCalendarEventId) continue;
      await this.unmarkTerraceEventPaid(
        tx.matchedCalendarEventId,
        tx.id,
        condominiumId,
        userId,
        this.prisma,
        batchTransactionIds,
      );
    }
  }

  // `client` lets the helper join a caller's transaction (ENGINE-019/020);
  // it defaults to the root client for standalone use.
  async markTerraceEventPaid(
    calendarEventId: string,
    transactionId: string,
    condominiumId: string,
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const ev = await client.calendarEvent.findFirst({
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
      // CAL-003: with in-run claiming + the TERRACE_DUPLICATE invariant, a second
      // approval landing on an already-PAID booking is now an anomaly (a stale
      // pre-Phase-3 duplicate link), not a routine no-op — log it at warn so it
      // is visible rather than silently swallowed.
      this.logger.warn(
        `markTerraceEventPaid: event ${calendarEventId} already PAID — skipping (transaction ${transactionId}; possible duplicate link)`,
      );
      return;
    }

    const updatedMetadata = { ...validation.data, paymentStatus: 'PAID' as const };

    await client.calendarEvent.update({
      where: { id: calendarEventId },
      data: { metadata: updatedMetadata as unknown as Prisma.InputJsonValue },
    });

    await client.auditLog.create({
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

  // CAL-005: `excludeTransactionIds` lets a caller that is about to settle/remove
  // several sibling rows at once (e.g. a batch delete) ignore them when checking
  // whether another approved payment still covers the booking.
  async unmarkTerraceEventPaid(
    calendarEventId: string,
    transactionId: string,
    condominiumId: string,
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
    excludeTransactionIds: string[] = [],
  ): Promise<void> {
    const ev = await client.calendarEvent.findFirst({
      where: { id: calendarEventId, condominiumId, deletedAt: null },
      select: { metadata: true },
    });
    if (!ev) {
      this.logger.warn(
        `unmarkTerraceEventPaid: event ${calendarEventId} not found or deleted — skipping revert`,
      );
      return;
    }

    const validation = validateTerraceMetadata(ev.metadata);
    if (!validation.valid) {
      this.logger.warn(
        `unmarkTerraceEventPaid: corrupt metadata on event ${calendarEventId} — ${validation.error}`,
      );
      return;
    }
    if (validation.data.paymentStatus === 'PENDING') {
      this.logger.debug(
        `unmarkTerraceEventPaid: event ${calendarEventId} already PENDING — skipping`,
      );
      return;
    }

    // CAL-005: another APPROVED transaction may still cover this booking (a
    // duplicate payment, or two payers). Reopening/removing THIS payment must not
    // flip a still-paid booking back to PENDING — only revert when no other
    // approved payment remains linked. Excluded ids are siblings the caller is
    // settling together and should not count as "still covering it".
    const stillCovered = await client.transaction.findFirst({
      where: {
        condominiumId,
        matchedCalendarEventId: calendarEventId,
        reconciliationStatus: ReconciliationStatus.APPROVED,
        id: { notIn: [transactionId, ...excludeTransactionIds] },
      },
      select: { id: true },
    });
    if (stillCovered) {
      this.logger.debug(
        `unmarkTerraceEventPaid: event ${calendarEventId} still covered by approved transaction ${stillCovered.id} — keeping PAID`,
      );
      return;
    }

    const updatedMetadata = { ...validation.data, paymentStatus: 'PENDING' as const };

    await client.calendarEvent.update({
      where: { id: calendarEventId },
      data: { metadata: updatedMetadata as unknown as Prisma.InputJsonValue },
    });

    await client.auditLog.create({
      data: {
        condominiumId,
        userId,
        action: 'TERRACE_BOOKING_PAYMENT_REVERTED',
        actionCategory: 'RECONCILIATION',
        module: 'calendar',
        entityType: 'CalendarEvent',
        entityId: calendarEventId,
        beforeState: { paymentStatus: validation.data.paymentStatus },
        afterState: { paymentStatus: 'PENDING', linkedTransactionId: transactionId },
        result: 'SUCCESS',
        description: `Terrace booking payment reverted via transaction ${transactionId} reopen`,
      },
    });
  }
}
