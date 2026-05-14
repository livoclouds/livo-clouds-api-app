import { ClassificationStatus } from '@prisma/client';
import { ClassificationService } from './classification.service';
import { TERRACE_BOOKING_DEFAULTS } from '../calendar/terrace-metadata.validator';

const CONDOMINIUM_ID = 'cond-1';
const BATCH_ID = 'batch-1';
const EVENT_DATE = new Date('2026-06-15T12:00:00Z');

function daysBefore(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() - days);
  return r;
}

interface PrismaMock {
  transaction: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
    groupBy: jest.Mock;
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  resident: { findMany: jest.Mock };
  calendarEvent: { findMany: jest.Mock };
  financialMonthlySummary: { upsert: jest.Mock };
}

function makePrismaMock(): PrismaMock {
  return {
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { credits: null, charges: null }, _count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    resident: { findMany: jest.fn().mockResolvedValue([]) },
    calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
    financialMonthlySummary: { upsert: jest.fn().mockResolvedValue(null) },
  };
}

function makeService(prisma: PrismaMock): ClassificationService {
  const rulesService = { findActive: jest.fn().mockResolvedValue([]) };
  return new ClassificationService(prisma as never, rulesService as never);
}

function findClassifierUpdate(
  updateMany: jest.Mock,
  transactionId: string,
): Record<string, unknown> | undefined {
  // The first updateMany call in reclassifyBatch is the reset (where: { condominiumId, importBatchId }).
  // Classifier-pass updates use where.id.in === [...]. Find the one that includes the target tx id.
  const found = updateMany.mock.calls.find(
    (args) => Array.isArray(args[0]?.where?.id?.in) && args[0].where.id.in.includes(transactionId),
  );
  return found?.[0]?.data as Record<string, unknown> | undefined;
}

describe('ClassificationService.reclassifyBatch — KI-001 regression', () => {
  it('reset payload clears matchedCalendarEventId alongside the other classification fields', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    await service.reclassifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const firstCall = prisma.transaction.updateMany.mock.calls[0];
    expect(firstCall[0]).toEqual({
      where: { condominiumId: CONDOMINIUM_ID, importBatchId: BATCH_ID },
      data: expect.objectContaining({
        classificationStatus: ClassificationStatus.NEEDS_REVIEW,
        residentId: null,
        matchSource: null,
        confidenceScore: null,
        matchedAt: null,
        requiresReviewReason: null,
        matchedRuleId: null,
        matchedCalendarEventId: null,
        classificationVersion: { increment: 1 },
      }),
    });
  });

  it('clears matchedCalendarEventId when the previously linked event no longer matches', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.resident.findMany.mockResolvedValue([
      { id: 'res-1', unitNumber: '5', firstName: 'Ana', lastName: 'Lopez' },
    ]);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        description: 'reservacion terraza junio casa 5',
        transactionDate: daysBefore(EVENT_DATE, 5),
        credits: 1500,
        charges: null,
        flowType: 'INCOME',
      },
    ]);
    prisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: 'event-stale',
        residentId: null,
        unitNumber: '5',
        startDate: EVENT_DATE,
        metadata: {
          ...TERRACE_BOOKING_DEFAULTS,
          terraceRentalAmount: 9999,
          paymentStatus: 'PENDING',
        },
      },
    ]);
    prisma.transaction.groupBy.mockImplementation(
      ({ by }: { by: string[] }) =>
        by.includes('transactionDate')
          ? Promise.resolve([{ transactionDate: daysBefore(EVENT_DATE, 5) }])
          : Promise.resolve([]),
    );

    await service.reclassifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchedCalendarEventId).toBeNull();
  });

  it('writes matchedCalendarEventId when reclassification still produces a valid terrace match', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.resident.findMany.mockResolvedValue([
      { id: 'res-1', unitNumber: '5', firstName: 'Ana', lastName: 'Lopez' },
    ]);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        description: 'reservacion terraza junio casa 5',
        transactionDate: daysBefore(EVENT_DATE, 5),
        credits: 1500,
        charges: null,
        flowType: 'INCOME',
      },
    ]);
    prisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: 'event-valid',
        residentId: null,
        unitNumber: '5',
        startDate: EVENT_DATE,
        metadata: {
          ...TERRACE_BOOKING_DEFAULTS,
          terraceRentalAmount: 1500,
          paymentStatus: 'PENDING',
        },
      },
    ]);
    prisma.transaction.groupBy.mockImplementation(
      ({ by }: { by: string[] }) =>
        by.includes('transactionDate')
          ? Promise.resolve([{ transactionDate: daysBefore(EVENT_DATE, 5) }])
          : Promise.resolve([]),
    );

    await service.reclassifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchedCalendarEventId).toBe('event-valid');
  });
});
