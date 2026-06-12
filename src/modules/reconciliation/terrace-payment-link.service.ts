// Terrace-booking payment links (ENGINE-008 decomposition, Phase 6). Marks a
// linked TERRACE_BOOKING event PAID on approval and reverts it on reopen /
// batch delete. Extracted verbatim from ClassificationService.
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    for (const tx of linked) {
      if (!tx.matchedCalendarEventId) continue;
      await this.unmarkTerraceEventPaid(
        tx.matchedCalendarEventId,
        tx.id,
        condominiumId,
        userId,
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
      this.logger.debug(
        `markTerraceEventPaid: event ${calendarEventId} already PAID — skipping`,
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

  async unmarkTerraceEventPaid(
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
