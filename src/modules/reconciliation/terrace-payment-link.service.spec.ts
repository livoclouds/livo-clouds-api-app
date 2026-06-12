// Unit safety net for TerracePaymentLinkService (CAL-008).
// Mocked Prisma — characterizes the mark/unmark/revert behaviors exactly as
// they exist today, including the silent no-ops Phase 3 will surface.
import { TerracePaymentLinkService } from './terrace-payment-link.service';
import type { TerraceBookingMetadata } from '../calendar/terrace-metadata.validator';

const CONDOMINIUM_ID = 'condo-1';
const EVENT_ID = 'evt-1';
const TX_ID = 'tx-1';
const USER_ID = 'user-42';
const BATCH_ID = 'batch-1';

interface PrismaMock {
  calendarEvent: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  transaction: { findMany: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    calendarEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeService(prisma: PrismaMock): TerracePaymentLinkService {
  return new TerracePaymentLinkService(prisma as never);
}

function validMetadata(
  overrides: Partial<TerraceBookingMetadata> = {},
): TerraceBookingMetadata {
  return {
    terraceRentalAmount: 1500,
    securityDepositAmount: 1000,
    paymentStatus: 'PENDING',
    securityDepositStatus: 'RECEIVED',
    contractSigned: true,
    guestParkingRequested: false,
    setupNotes: 'tables for 20',
    postEventReviewed: false,
    damagesReported: false,
    cleaningIssueReported: false,
    depositDeductionAmount: 0,
    depositDeductionReason: '',
    postEventReviewNotes: '',
    customKeywords: ['quincea'],
    ...overrides,
  };
}

describe('TerracePaymentLinkService.markTerraceEventPaid', () => {
  it('writes paymentStatus PAID into metadata, preserving every other field', async () => {
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({ metadata: validMetadata() });
    const service = makeService(prisma);

    await service.markTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID);

    expect(prisma.calendarEvent.update).toHaveBeenCalledTimes(1);
    const args = prisma.calendarEvent.update.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: { metadata: TerraceBookingMetadata };
    };
    expect(args.where).toEqual({ id: EVENT_ID });
    expect(args.data.metadata).toEqual(validMetadata({ paymentStatus: 'PAID' }));
    // Non-payment fields survive the rewrite untouched.
    expect(args.data.metadata.terraceRentalAmount).toBe(1500);
    expect(args.data.metadata.securityDepositStatus).toBe('RECEIVED');
    // customKeywords pass through the validator's normalization (trim+lowercase).
    expect(args.data.metadata.customKeywords).toEqual(['quincea']);
  });

  it('writes a TERRACE_BOOKING_MARKED_PAID audit entry linking the transaction', async () => {
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({ metadata: validMetadata() });
    const service = makeService(prisma);

    await service.markTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.auditLog.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.action).toBe('TERRACE_BOOKING_MARKED_PAID');
    expect(data.condominiumId).toBe(CONDOMINIUM_ID);
    expect(data.userId).toBe(USER_ID);
    expect(data.entityType).toBe('CalendarEvent');
    expect(data.entityId).toBe(EVENT_ID);
    expect(data.beforeState).toEqual({ paymentStatus: 'PENDING' });
    expect(data.afterState).toEqual({
      paymentStatus: 'PAID',
      linkedTransactionId: TX_ID,
    });
  });

  it('scopes the lookup by tenant: where = { id, condominiumId, deletedAt: null }', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    await service.markTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID);

    expect(prisma.calendarEvent.findFirst).toHaveBeenCalledWith({
      where: { id: EVENT_ID, condominiumId: CONDOMINIUM_ID, deletedAt: null },
      select: { metadata: true },
    });
  });

  it('is a no-op when the event is not found or soft-deleted', async () => {
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce(null);
    const service = makeService(prisma);

    await expect(
      service.markTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID),
    ).resolves.toBeUndefined();

    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('is a no-op when the stored metadata is corrupt (fails validation)', async () => {
    const prisma = makePrismaMock();
    // A non-object metadata column is the canonical corruption shape.
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({ metadata: 'corrupt' });
    const service = makeService(prisma);

    await expect(
      service.markTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID),
    ).resolves.toBeUndefined();

    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('is a no-op when metadata carries unknown fields (validator rejects)', async () => {
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({
      metadata: { ...validMetadata(), rogueField: true },
    });
    const service = makeService(prisma);

    await service.markTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID);

    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('silently skips an event that is already PAID (no write, no audit)', async () => {
    // CAL-003: duplicate absorption is silent today — Phase 3 will surface it.
    // A second matching transaction approving against an already-PAID booking
    // leaves no trace: no metadata write, no audit row, no error.
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({
      metadata: validMetadata({ paymentStatus: 'PAID' }),
    });
    const service = makeService(prisma);

    await expect(
      service.markTerraceEventPaid(EVENT_ID, 'tx-second-payer', CONDOMINIUM_ID, USER_ID),
    ).resolves.toBeUndefined();

    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('runs on a supplied transaction client instead of the root client', async () => {
    const prisma = makePrismaMock();
    const txClient = makePrismaMock();
    txClient.calendarEvent.findFirst.mockResolvedValueOnce({ metadata: validMetadata() });
    const service = makeService(prisma);

    await service.markTerraceEventPaid(
      EVENT_ID,
      TX_ID,
      CONDOMINIUM_ID,
      USER_ID,
      txClient as never,
    );

    // All reads/writes go through the caller's transaction client...
    expect(txClient.calendarEvent.findFirst).toHaveBeenCalledTimes(1);
    expect(txClient.calendarEvent.update).toHaveBeenCalledTimes(1);
    expect(txClient.auditLog.create).toHaveBeenCalledTimes(1);
    // ...and never through the root client.
    expect(prisma.calendarEvent.findFirst).not.toHaveBeenCalled();
    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('TerracePaymentLinkService.unmarkTerraceEventPaid', () => {
  it('reverts a PAID booking to PENDING and writes the revert audit entry', async () => {
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({
      metadata: validMetadata({ paymentStatus: 'PAID' }),
    });
    const service = makeService(prisma);

    await service.unmarkTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID);

    expect(prisma.calendarEvent.update).toHaveBeenCalledTimes(1);
    const args = prisma.calendarEvent.update.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: { metadata: TerraceBookingMetadata };
    };
    expect(args.where).toEqual({ id: EVENT_ID });
    expect(args.data.metadata.paymentStatus).toBe('PENDING');
    // The rest of the metadata is preserved.
    expect(args.data.metadata.securityDepositAmount).toBe(1000);

    const { data } = prisma.auditLog.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.action).toBe('TERRACE_BOOKING_PAYMENT_REVERTED');
    expect(data.beforeState).toEqual({ paymentStatus: 'PAID' });
    expect(data.afterState).toEqual({
      paymentStatus: 'PENDING',
      linkedTransactionId: TX_ID,
    });
  });

  it('skips a booking that is already PENDING (no write, no audit)', async () => {
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({
      metadata: validMetadata({ paymentStatus: 'PENDING' }),
    });
    const service = makeService(prisma);

    await service.unmarkTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID);

    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('skips a deleted/missing event', async () => {
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce(null);
    const service = makeService(prisma);

    await expect(
      service.unmarkTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID),
    ).resolves.toBeUndefined();

    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('skips corrupt metadata', async () => {
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({ metadata: [1, 2, 3] });
    const service = makeService(prisma);

    await service.unmarkTerraceEventPaid(EVENT_ID, TX_ID, CONDOMINIUM_ID, USER_ID);

    expect(prisma.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('reverts regardless of WHICH transaction originally paid the booking', async () => {
    // CAL-005: no APPROVED-guard / other-payer check — Phase 3.
    // The service only reads `metadata`; it never verifies that the reopening
    // transaction is the one whose approval marked the booking PAID, nor that
    // another APPROVED transaction still covers it. Any caller-supplied
    // transactionId reverts the booking to PENDING.
    const prisma = makePrismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValueOnce({
      metadata: validMetadata({ paymentStatus: 'PAID' }),
    });
    const service = makeService(prisma);

    await service.unmarkTerraceEventPaid(
      EVENT_ID,
      'tx-unrelated-payer',
      CONDOMINIUM_ID,
      USER_ID,
    );

    // The lookup selects metadata only — no transaction table consultation.
    expect(prisma.calendarEvent.findFirst).toHaveBeenCalledWith({
      where: { id: EVENT_ID, condominiumId: CONDOMINIUM_ID, deletedAt: null },
      select: { metadata: true },
    });
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    // The revert still happens, attributed to the unrelated transaction.
    expect(prisma.calendarEvent.update).toHaveBeenCalledTimes(1);
    const { data } = prisma.auditLog.create.mock.calls[0][0] as {
      data: { afterState: Record<string, unknown> };
    };
    expect(data.afterState.linkedTransactionId).toBe('tx-unrelated-payer');
  });
});

describe('TerracePaymentLinkService.revertTerraceLinksForBatch', () => {
  it('reverts every linked booking of the batch, scoped by tenant', async () => {
    const prisma = makePrismaMock();
    prisma.transaction.findMany.mockResolvedValueOnce([
      { id: 'tx-a', matchedCalendarEventId: 'evt-a' },
      { id: 'tx-b', matchedCalendarEventId: 'evt-b' },
    ]);
    const service = makeService(prisma);
    const unmarkSpy = jest
      .spyOn(service, 'unmarkTerraceEventPaid')
      .mockResolvedValue(undefined);

    await service.revertTerraceLinksForBatch(CONDOMINIUM_ID, BATCH_ID, USER_ID);

    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: {
        condominiumId: CONDOMINIUM_ID,
        importBatchId: BATCH_ID,
        matchedCalendarEventId: { not: null },
      },
      select: { id: true, matchedCalendarEventId: true },
    });
    expect(unmarkSpy).toHaveBeenCalledTimes(2);
    expect(unmarkSpy).toHaveBeenNthCalledWith(1, 'evt-a', 'tx-a', CONDOMINIUM_ID, USER_ID);
    expect(unmarkSpy).toHaveBeenNthCalledWith(2, 'evt-b', 'tx-b', CONDOMINIUM_ID, USER_ID);
  });

  it('does nothing when the batch has no linked transactions', async () => {
    const prisma = makePrismaMock();
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    const service = makeService(prisma);
    const unmarkSpy = jest.spyOn(service, 'unmarkTerraceEventPaid');

    await service.revertTerraceLinksForBatch(CONDOMINIUM_ID, BATCH_ID, USER_ID);

    expect(unmarkSpy).not.toHaveBeenCalled();
  });

  it('skips rows whose matchedCalendarEventId is null (defensive guard)', async () => {
    const prisma = makePrismaMock();
    prisma.transaction.findMany.mockResolvedValueOnce([
      { id: 'tx-a', matchedCalendarEventId: null },
      { id: 'tx-b', matchedCalendarEventId: 'evt-b' },
    ]);
    const service = makeService(prisma);
    const unmarkSpy = jest
      .spyOn(service, 'unmarkTerraceEventPaid')
      .mockResolvedValue(undefined);

    await service.revertTerraceLinksForBatch(CONDOMINIUM_ID, BATCH_ID, USER_ID);

    expect(unmarkSpy).toHaveBeenCalledTimes(1);
    expect(unmarkSpy).toHaveBeenCalledWith('evt-b', 'tx-b', CONDOMINIUM_ID, USER_ID);
  });
});
