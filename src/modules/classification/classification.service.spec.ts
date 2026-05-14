import { ClassificationStatus, RequiresReviewReason } from '@prisma/client';
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
  condominiumSettings: { findUnique: jest.Mock };
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
    // Phase 5F (KI-004): default to no tenant-level keywords so existing tests stay green.
    condominiumSettings: {
      findUnique: jest.fn().mockResolvedValue({ terraceGlobalKeywords: [] }),
    },
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

describe('ClassificationService.classifyBatch — KI-002 resident signal', () => {
  function setupCommonMocks(
    prisma: PrismaMock,
    {
      residents,
      description,
      candidate,
    }: {
      residents: Array<{ id: string; unitNumber: string; firstName: string; lastName: string }>;
      description: string;
      candidate: {
        id: string;
        residentId: string | null;
        unitNumber: string | null;
        terraceRentalAmount: number;
      };
    },
  ): void {
    prisma.resident.findMany.mockResolvedValue(residents);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        description,
        transactionDate: daysBefore(EVENT_DATE, 5),
        credits: 1500,
        charges: null,
        flowType: 'INCOME',
      },
    ]);
    prisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: candidate.id,
        residentId: candidate.residentId,
        unitNumber: candidate.unitNumber,
        startDate: EVENT_DATE,
        metadata: {
          ...TERRACE_BOOKING_DEFAULTS,
          terraceRentalAmount: candidate.terraceRentalAmount,
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
  }

  it('routes resident + unit match to AUTO with confidence 0.95', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    setupCommonMocks(prisma, {
      residents: [{ id: 'res-1', unitNumber: '5', firstName: 'Ana', lastName: 'Lopez' }],
      description: 'reservacion terraza junio casa 5',
      candidate: { id: 'event-resident-unit', residentId: 'res-1', unitNumber: '5', terraceRentalAmount: 1500 },
    });

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(data!.classificationStatus).toBe(ClassificationStatus.AUTO);
    expect((data!.confidenceScore as { toString(): string }).toString()).toBe('0.95');
    expect(data!.matchedCalendarEventId).toBe('event-resident-unit');
    expect(data!.residentId).toBe('res-1');
    expect(data!.requiresReviewReason).toBeNull();
  });

  it('routes resident-only match to AUTO with confidence 0.90 when candidate has no unit', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    setupCommonMocks(prisma, {
      residents: [{ id: 'res-1', unitNumber: '5', firstName: 'Ana', lastName: 'Lopez' }],
      description: 'reservacion terraza junio casa 5',
      candidate: { id: 'event-resident-only', residentId: 'res-1', unitNumber: null, terraceRentalAmount: 1500 },
    });

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(data!.classificationStatus).toBe(ClassificationStatus.AUTO);
    expect((data!.confidenceScore as { toString(): string }).toString()).toBe('0.9');
    expect(data!.matchedCalendarEventId).toBe('event-resident-only');
    expect(data!.residentId).toBe('res-1');
    expect(data!.requiresReviewReason).toBeNull();
  });

  it('keeps unit-only match at AUTO 0.88 when no resident exists for the detected unit (regression)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    setupCommonMocks(prisma, {
      residents: [{ id: 'res-9', unitNumber: '9', firstName: 'Otra', lastName: 'Persona' }],
      description: 'reservacion terraza junio casa 5',
      candidate: { id: 'event-unit-only', residentId: null, unitNumber: '5', terraceRentalAmount: 1500 },
    });

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(data!.classificationStatus).toBe(ClassificationStatus.AUTO);
    expect((data!.confidenceScore as { toString(): string }).toString()).toBe('0.88');
    expect(data!.matchedCalendarEventId).toBe('event-unit-only');
    expect(data!.residentId).toBeNull();
  });

  it('keeps keyword-only match at NEEDS_REVIEW 0.70 LOW_CONFIDENCE (regression)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    setupCommonMocks(prisma, {
      residents: [{ id: 'res-1', unitNumber: '5', firstName: 'Ana', lastName: 'Lopez' }],
      description: 'reservacion para evento',
      candidate: { id: 'event-keyword-only', residentId: 'res-1', unitNumber: '5', terraceRentalAmount: 1500 },
    });

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(data!.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
    expect((data!.confidenceScore as { toString(): string }).toString()).toBe('0.7');
    expect(data!.matchedCalendarEventId).toBe('event-keyword-only');
    expect(data!.requiresReviewReason).toBe(RequiresReviewReason.LOW_CONFIDENCE);
  });

  it('does not escalate confidence when the detected unit maps to multiple residents (safety)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    setupCommonMocks(prisma, {
      residents: [
        { id: 'res-1', unitNumber: '5', firstName: 'Ana', lastName: 'Lopez' },
        { id: 'res-2', unitNumber: '5', firstName: 'Carlos', lastName: 'Diaz' },
      ],
      description: 'reservacion terraza junio casa 5',
      candidate: { id: 'event-shared-unit', residentId: 'res-1', unitNumber: '5', terraceRentalAmount: 1500 },
    });

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(data!.classificationStatus).toBe(ClassificationStatus.AUTO);
    expect((data!.confidenceScore as { toString(): string }).toString()).toBe('0.88');
    expect(data!.matchedCalendarEventId).toBe('event-shared-unit');
    expect(data!.residentId).toBeNull();
  });
});

describe('ClassificationService.classifyBatch — Phase 5F global terrace keywords', () => {
  function setupBaseMocks(
    prisma: PrismaMock,
    {
      description,
      candidate,
      globalKeywords,
      residents = [],
    }: {
      description: string;
      candidate: {
        id: string;
        residentId: string | null;
        unitNumber: string | null;
        terraceRentalAmount: number;
      };
      globalKeywords: string[];
      residents?: Array<{ id: string; unitNumber: string; firstName: string; lastName: string }>;
    },
  ): void {
    prisma.resident.findMany.mockResolvedValue(residents);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        description,
        transactionDate: daysBefore(EVENT_DATE, 5),
        credits: 1500,
        charges: null,
        flowType: 'INCOME',
      },
    ]);
    prisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: candidate.id,
        residentId: candidate.residentId,
        unitNumber: candidate.unitNumber,
        startDate: EVENT_DATE,
        metadata: {
          ...TERRACE_BOOKING_DEFAULTS,
          terraceRentalAmount: candidate.terraceRentalAmount,
          paymentStatus: 'PENDING',
        },
      },
    ]);
    prisma.condominiumSettings.findUnique.mockResolvedValue({ terraceGlobalKeywords: globalKeywords });
    prisma.transaction.groupBy.mockImplementation(
      ({ by }: { by: string[] }) =>
        by.includes('transactionDate')
          ? Promise.resolve([{ transactionDate: daysBefore(EVENT_DATE, 5) }])
          : Promise.resolve([]),
    );
  }

  it('matches via tenant-level terraceGlobalKeywords + unit signal at AUTO 0.88', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    setupBaseMocks(prisma, {
      description: 'pago kiosko casa 5 marzo',
      candidate: { id: 'event-global-unit', residentId: null, unitNumber: '5', terraceRentalAmount: 1500 },
      globalKeywords: ['kiosko'],
    });

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(data!.classificationStatus).toBe(ClassificationStatus.AUTO);
    expect((data!.confidenceScore as { toString(): string }).toString()).toBe('0.88');
    expect(data!.matchedCalendarEventId).toBe('event-global-unit');
  });

  it('matches via tenant-level keyword alone as keyword-only NEEDS_REVIEW 0.70', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    setupBaseMocks(prisma, {
      description: 'pago kiosko marzo',
      candidate: { id: 'event-global-only', residentId: null, unitNumber: null, terraceRentalAmount: 1500 },
      globalKeywords: ['kiosko'],
    });

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect(data!.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
    expect((data!.confidenceScore as { toString(): string }).toString()).toBe('0.7');
    expect(data!.requiresReviewReason).toBe(RequiresReviewReason.LOW_CONFIDENCE);
  });

  it('does not classify amount + date alone — empty globalKeywords + no other signals → null match', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    setupBaseMocks(prisma, {
      description: 'TRANSFERENCIA SPEI 12345',
      candidate: { id: 'event-noop', residentId: null, unitNumber: null, terraceRentalAmount: 1500 },
      globalKeywords: [],
    });

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.matchedCalendarEventId).toBeNull();
    expect(data!.matchSource).not.toBe('AUTO_TERRACE_BOOKING');
  });

  it('handles missing CondominiumSettings row (findUnique returns null) by treating globals as empty', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.resident.findMany.mockResolvedValue([]);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        description: 'reservacion terraza casa 5',
        transactionDate: daysBefore(EVENT_DATE, 5),
        credits: 1500,
        charges: null,
        flowType: 'INCOME',
      },
    ]);
    prisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: 'event-no-settings',
        residentId: null,
        unitNumber: '5',
        startDate: EVENT_DATE,
        metadata: { ...TERRACE_BOOKING_DEFAULTS, terraceRentalAmount: 1500, paymentStatus: 'PENDING' },
      },
    ]);
    prisma.condominiumSettings.findUnique.mockResolvedValue(null);
    prisma.transaction.groupBy.mockImplementation(
      ({ by }: { by: string[] }) =>
        by.includes('transactionDate')
          ? Promise.resolve([{ transactionDate: daysBefore(EVENT_DATE, 5) }])
          : Promise.resolve([]),
    );

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    // Hardcoded "terraza" + unit signal still produce AUTO 0.88 even without a settings row.
    expect(data!.matchSource).toBe('AUTO_TERRACE_BOOKING');
    expect((data!.confidenceScore as { toString(): string }).toString()).toBe('0.88');
  });
});
