import {
  ClassificationStatus,
  FlowType,
  MatchSource,
  ReconciliationRuleKind,
  RequiresReviewReason,
} from '@prisma/client';
import {
  ClassificationService,
  extractFromText,
  extractFromBanBajio,
  parseMaintenanceConcept,
  resolveNearestCycle,
  resolveRuleUnit,
  type DbRule,
} from './classification.service';
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
    findFirst: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    groupBy: jest.Mock;
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  resident: { findFirst: jest.Mock; findMany: jest.Mock };
  calendarEvent: { findMany: jest.Mock };
  condominiumSettings: { findUnique: jest.Mock };
  financialMonthlySummary: { upsert: jest.Mock };
  auditLog: { create: jest.Mock };
  reconciliationCorrectionPattern: { upsert: jest.Mock };
  paymentAllocation: { deleteMany: jest.Mock; createMany: jest.Mock; aggregate: jest.Mock };
  importBatch: { update: jest.Mock; updateMany: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    transaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { credits: null, charges: null }, _count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    resident: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
    // Phase 5F (KI-004): default to no tenant-level keywords so existing tests stay green.
    condominiumSettings: {
      findUnique: jest.fn().mockResolvedValue({ terraceGlobalKeywords: [] }),
    },
    financialMonthlySummary: { upsert: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn().mockResolvedValue(null) },
    reconciliationCorrectionPattern: { upsert: jest.fn().mockResolvedValue(null) },
    paymentAllocation: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { allocatedAmount: null } }),
    },
    importBatch: {
      update: jest.fn().mockResolvedValue(null),
      // ENGINE-058: reclassifyBatch syncs the persisted batch summary columns.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      // classifyBatch reads the batch's bank profile to drive bank-specific
      // extraction. Default to no profile so existing tests stay bank-agnostic.
      findUnique: jest.fn().mockResolvedValue({ bankProfile: null }),
    },
    // REV-003 / REV-017: support both forms — array (chunk classifyBatch) and
    // callback (single-row overrides). The callback receives the same mock as `tx`.
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaMock) => Promise<unknown>)(mock);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return undefined;
  });
  return mock;
}

function makeService(
  prisma: PrismaMock,
  activeRules: unknown[] = [],
): ClassificationService {
  const rulesService = { findActive: jest.fn().mockResolvedValue(activeRules) };
  const events = { emit: jest.fn() };
  // Phase 6 (A5): the service now reads terrace keywords via SettingsCacheService.
  // The mock forwards to the existing condominiumSettings.findUnique mock so the
  // terrace-keyword tests keep configuring behavior the same way.
  const settingsCache = {
    getSettings: jest.fn((condominiumId: string) =>
      prisma.condominiumSettings.findUnique({ where: { condominiumId } }),
    ),
    invalidate: jest.fn(),
  };
  return new ClassificationService(
    prisma as never,
    rulesService as never,
    events as never,
    settingsCache as never,
  );
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

    await service.reclassifyBatch(CONDOMINIUM_ID, BATCH_ID, null);

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

    await service.reclassifyBatch(CONDOMINIUM_ID, BATCH_ID, null);

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

    await service.reclassifyBatch(CONDOMINIUM_ID, BATCH_ID, null);

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

const TX_ID = 'tx-rev003';
const USER_ID = 'user-rev003';
const NOW = new Date('2026-05-15T12:00:00Z');

describe('ClassificationService.manualMatch — REV-003 optimistic locking', () => {
  it('throws ConflictException with STALE_OVERRIDE when updateMany count is 0 (concurrent update lost the race)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.resident.findFirst.mockResolvedValue({ id: 'res-1', condominiumId: CONDOMINIUM_ID });
    prisma.transaction.findFirst.mockResolvedValue({
      updatedAt: NOW,
      residentId: null,
      matchSource: null,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.NO_MATCH,
      matchedRuleId: null,
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 0 });

    let caught: unknown;
    try {
      await service.manualMatch(CONDOMINIUM_ID, TX_ID, 'res-1', USER_ID);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    const response = (caught as { getStatus(): number; getResponse(): unknown }).getResponse();
    expect((caught as { getStatus(): number }).getStatus()).toBe(409);
    expect(response).toMatchObject({ code: 'STALE_OVERRIDE' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('writes audit row when the updateMany succeeds (count: 1)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.resident.findFirst.mockResolvedValue({ id: 'res-1', condominiumId: CONDOMINIUM_ID });
    prisma.transaction.findFirst.mockResolvedValue({
      updatedAt: NOW,
      residentId: null,
      matchSource: null,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.NO_MATCH,
      matchedRuleId: null,
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    await service.manualMatch(CONDOMINIUM_ID, TX_ID, 'res-1', USER_ID);

    const updateCall = prisma.transaction.updateMany.mock.calls[0];
    expect(updateCall[0]).toMatchObject({
      where: { id: TX_ID, condominiumId: CONDOMINIUM_ID, updatedAt: NOW },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'TRANSACTION_MATCHED_MANUALLY',
      userId: USER_ID,
    });
  });
});

describe('ClassificationService.manualClassify — REV-003 optimistic locking', () => {
  it('throws ConflictException and skips pattern upsert + audit when updateMany count is 0', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValue({
      updatedAt: NOW,
      description: 'Test',
      residentId: null,
      unitNumberDetected: null,
      paymentConcept: null,
      paymentPeriodMonth: null,
      paymentPeriodYear: null,
      transactionDate: NOW,
      matchSource: null,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.NO_MATCH,
      matchedRuleId: null,
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 0 });

    let caught: unknown;
    try {
      await service.manualClassify(
        CONDOMINIUM_ID,
        TX_ID,
        { paymentConcept: 'MAINTENANCE' },
        USER_ID,
      );
    } catch (err) {
      caught = err;
    }

    expect((caught as { getStatus(): number }).getStatus()).toBe(409);
    expect(
      (caught as { getResponse(): unknown }).getResponse(),
    ).toMatchObject({ code: 'STALE_OVERRIDE' });
    expect(prisma.reconciliationCorrectionPattern.upsert).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('writes pattern upsert + audit row on successful update (count: 1)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValue({
      updatedAt: NOW,
      description: 'PAGO MARZO CASA 5',
      residentId: null,
      unitNumberDetected: null,
      paymentConcept: null,
      paymentPeriodMonth: null,
      paymentPeriodYear: null,
      transactionDate: NOW,
      matchSource: null,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      requiresReviewReason: RequiresReviewReason.NO_MATCH,
      matchedRuleId: null,
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    await service.manualClassify(
      CONDOMINIUM_ID,
      TX_ID,
      { paymentConcept: 'MAINTENANCE' },
      USER_ID,
    );

    expect(prisma.reconciliationCorrectionPattern.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'TRANSACTION_CLASSIFIED_MANUALLY',
      userId: USER_ID,
    });
  });
});

describe('ClassificationService.manualClassify — REV-004 strict unit resolution', () => {
  it('throws BadRequestException UNIT_NOT_FOUND when unitNumber is non-empty and unresolved', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.resident.findFirst.mockResolvedValue(null);

    let caught: unknown;
    try {
      await service.manualClassify(
        CONDOMINIUM_ID,
        TX_ID,
        { unitNumber: '9999' },
        USER_ID,
      );
    } catch (err) {
      caught = err;
    }

    expect((caught as { getStatus(): number }).getStatus()).toBe(400);
    expect(
      (caught as { getResponse(): unknown }).getResponse(),
    ).toMatchObject({ code: 'UNIT_NOT_FOUND', field: 'unitNumber', unitNumber: '9999' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('explicitly clears residentId when unitNumber is empty string (admin chose to clear)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValue({
      updatedAt: NOW,
      description: 'Test',
      residentId: 'res-prev',
      unitNumberDetected: '5',
      paymentConcept: null,
      paymentPeriodMonth: null,
      paymentPeriodYear: null,
      transactionDate: NOW,
      matchSource: 'MANUAL',
      classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
      requiresReviewReason: null,
      matchedRuleId: null,
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    await service.manualClassify(
      CONDOMINIUM_ID,
      TX_ID,
      { unitNumber: '' },
      USER_ID,
    );

    expect(prisma.resident.findFirst).not.toHaveBeenCalled();
    expect(prisma.transaction.updateMany.mock.calls[0][0].data).toMatchObject({
      unitNumberDetected: null,
      residentId: null,
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data.afterState).toMatchObject({
      residentId: null,
      unitNumberDetected: null,
    });
  });
});

describe('ClassificationService.unmatch — REV-003 optimistic locking', () => {
  it('throws ConflictException and skips audit when updateMany count is 0', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValue({
      updatedAt: NOW,
      residentId: 'res-prev',
      matchSource: 'MANUAL',
      classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
      requiresReviewReason: null,
      matchedRuleId: null,
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 0 });

    let caught: unknown;
    try {
      await service.unmatch(CONDOMINIUM_ID, TX_ID, USER_ID);
    } catch (err) {
      caught = err;
    }

    expect((caught as { getStatus(): number }).getStatus()).toBe(409);
    expect(
      (caught as { getResponse(): unknown }).getResponse(),
    ).toMatchObject({ code: 'STALE_OVERRIDE' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('writes TRANSACTION_UNMATCHED audit row on successful update', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValue({
      updatedAt: NOW,
      residentId: 'res-prev',
      matchSource: 'MANUAL',
      classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
      requiresReviewReason: null,
      matchedRuleId: null,
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    await service.unmatch(CONDOMINIUM_ID, TX_ID, USER_ID);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'TRANSACTION_UNMATCHED',
      userId: USER_ID,
    });
  });

  it('writes MANUAL_UNMATCHED (not NO_MATCH) so reports can distinguish admin overrides — REV-016', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.transaction.findFirst.mockResolvedValue({
      updatedAt: NOW,
      residentId: 'res-prev',
      matchSource: 'MANUAL',
      classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
      requiresReviewReason: null,
      matchedRuleId: null,
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    await service.unmatch(CONDOMINIUM_ID, TX_ID, USER_ID);

    expect(prisma.transaction.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.updateMany.mock.calls[0][0].data).toMatchObject({
      requiresReviewReason: RequiresReviewReason.MANUAL_UNMATCHED,
      classificationStatus: ClassificationStatus.NEEDS_REVIEW,
      residentId: null,
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data.afterState).toMatchObject({
      requiresReviewReason: RequiresReviewReason.MANUAL_UNMATCHED,
    });
  });
});

describe('ClassificationService.classifyBatch — REV-017 chunk atomicity', () => {
  it('wraps the per-chunk updateMany calls in $transaction(array form)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.resident.findMany.mockResolvedValue([]);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-a',
        description: 'CARGO',
        transactionDate: NOW,
        credits: null,
        charges: 100,
        flowType: 'EXPENSE',
      },
    ]);

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    // $transaction is invoked once per non-empty chunk; here the single tx
    // produces exactly one chunk → one $transaction call with an array payload.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const arg = prisma.$transaction.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
  });

  it('propagates a chunk failure (rolls back chunk 2 while chunk 1 stays committed)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    // 250 transactions → two chunks of 200 + 50 = two $transaction invocations.
    const txs = Array.from({ length: 250 }, (_, i) => ({
      id: `tx-${i}`,
      description: 'CARGO ' + i,
      transactionDate: NOW,
      credits: null,
      charges: 100 + i,  // distinct payloads → no group collapse
      flowType: 'EXPENSE',
    }));
    prisma.transaction.findMany.mockResolvedValue(txs);

    // Chunk 1 succeeds; chunk 2 throws (simulated DB error / forced rollback).
    prisma.$transaction
      .mockImplementationOnce(async (arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg) : undefined,
      )
      .mockImplementationOnce(async () => {
        throw new Error('forced chunk-2 failure');
      });

    await expect(service.classifyBatch(CONDOMINIUM_ID, BATCH_ID)).rejects.toThrow(
      'forced chunk-2 failure',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe('extractFromText — payment period extraction', () => {
  it('extracts month + year from full Spanish month name followed by year', () => {
    const r = extractFromText('Pago mantenimiento abril 2026 casa 12');
    expect(r.paymentPeriodMonth).toBe(4);
    expect(r.paymentPeriodYear).toBe(2026);
  });

  it('extracts month + year from English month name followed by year', () => {
    const r = extractFromText('Maintenance fee may 2026');
    expect(r.paymentPeriodMonth).toBe(5);
    expect(r.paymentPeriodYear).toBe(2026);
  });

  it('extracts month + year from Spanish month abbreviation with slash', () => {
    const r = extractFromText('Cuota mantenimiento abr/2026');
    expect(r.paymentPeriodMonth).toBe(4);
    expect(r.paymentPeriodYear).toBe(2026);
  });

  it('extracts month + year from numeric MM/YYYY pattern', () => {
    const r = extractFromText('Pago 04/2026 casa 12');
    expect(r.paymentPeriodMonth).toBe(4);
    expect(r.paymentPeriodYear).toBe(2026);
  });

  it('extracts month + year from numeric M/YYYY pattern', () => {
    const r = extractFromText('mensualidad 5/2026');
    expect(r.paymentPeriodMonth).toBe(5);
    expect(r.paymentPeriodYear).toBe(2026);
  });

  it('returns null for both fields when no period is present (SPEI with no period info)', () => {
    const r = extractFromText(
      'SPEI Recibido: | Institucion contraparte: BBVA MEXICO Ordenante: MAYRA GUTIERREZ | Cuenta: 012180001234567890',
    );
    expect(r.paymentPeriodMonth).toBeNull();
    expect(r.paymentPeriodYear).toBeNull();
  });

  it('does not extract month from a name containing a month abbreviation (Marquez, Mayra, Abrego, Sepulveda)', () => {
    const r = extractFromText(
      'SPEI Enviado: | Beneficiario: MARQUEZ MAYRA ABREGO SEPULVEDA | Concepto: pago',
    );
    expect(r.paymentPeriodMonth).toBeNull();
    expect(r.paymentPeriodYear).toBeNull();
  });

  it('does not extract year from an account number that happens to contain 20XX', () => {
    const r = extractFromText(
      'SPEI Recibido: | Cuenta: 002014567890123456 | Clave de rastreo: 20019988',
    );
    expect(r.paymentPeriodMonth).toBeNull();
    expect(r.paymentPeriodYear).toBeNull();
  });

  it('rejects an isolated month name without a year nearby', () => {
    const r = extractFromText('Pago de abril sin año');
    expect(r.paymentPeriodMonth).toBeNull();
    expect(r.paymentPeriodYear).toBeNull();
  });

  it('rejects an isolated year without a month nearby', () => {
    const r = extractFromText('Referencia 2026 sin mes');
    expect(r.paymentPeriodMonth).toBeNull();
    expect(r.paymentPeriodYear).toBeNull();
  });
});

describe('ClassificationService.classifyTransaction — payment period date fallback', () => {
  const service = makeService(makePrismaMock());

  it('defaults to transactionDate month/year when description carries no period (31 mar 2026 → 3/2026)', () => {
    const r = service.classifyTransaction(
      'SPEI Recibido: | Institucion contraparte: BBVA MEXICO Ordenante: KARLA SOTO | Cuenta: 012180001234567890',
      new Date('2026-03-31T00:00:00Z'),
      [],
      [],
    );
    expect(r.paymentPeriodMonth).toBe(3);
    expect(r.paymentPeriodYear).toBe(2026);
  });

  it('defaults to transactionDate month/year for an April transaction with no period in description (4 abr 2026 → 4/2026)', () => {
    const r = service.classifyTransaction(
      'SPEI Enviado: | Beneficiario: MARIA RAMIREZ | Ref: 99887766',
      new Date('2026-04-04T00:00:00Z'),
      [],
      [],
    );
    expect(r.paymentPeriodMonth).toBe(4);
    expect(r.paymentPeriodYear).toBe(2026);
  });

  it('lets an explicit description period override the date fallback ("abril 2026" wins over 31 mar 2026 → 4/2026)', () => {
    const r = service.classifyTransaction(
      'Pago mantenimiento abril 2026',
      new Date('2026-03-31T00:00:00Z'),
      [],
      [],
    );
    expect(r.paymentPeriodMonth).toBe(4);
    expect(r.paymentPeriodYear).toBe(2026);
  });

  it('falls back to date when description has an isolated 20XX in account/reference numbers (no parasitic year)', () => {
    const r = service.classifyTransaction(
      'SPEI Recibido: | Cuenta: 002014567890123456 | Clave de rastreo: 20019988',
      new Date('2026-03-31T00:00:00Z'),
      [],
      [],
    );
    expect(r.paymentPeriodMonth).toBe(3);
    expect(r.paymentPeriodYear).toBe(2026);
  });
});

describe('ClassificationService.classifyBatch — progress counter', () => {
  it('resets processedCount to 0 and advances it to the total across chunks', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    // 450 transactions → 3 chunks of 200/200/50.
    const txs = Array.from({ length: 450 }, (_v, i) => ({
      id: `tx-${i}`,
      description: 'pago generico',
      transactionDate: daysBefore(EVENT_DATE, 5),
      credits: 100,
      charges: null,
      flowType: 'INCOME' as const,
    }));
    prisma.transaction.findMany.mockResolvedValue(txs);

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const processed = prisma.importBatch.update.mock.calls.map(
      (args) => (args[0].data as { processedCount: number }).processedCount,
    );
    // First write is the reset, last reaches the total, monotonically non-decreasing.
    expect(processed[0]).toBe(0);
    expect(processed[processed.length - 1]).toBe(450);
    expect(processed).toEqual([0, 200, 400, 450]);
    prisma.importBatch.update.mock.calls.forEach((args) => {
      expect(args[0].where).toEqual({ id: BATCH_ID });
    });
  });

  it('does not fail classification when the progress write throws', async () => {
    const prisma = makePrismaMock();
    prisma.importBatch.update.mockRejectedValue(new Error('row gone'));
    const service = makeService(prisma);

    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        description: 'pago generico',
        transactionDate: daysBefore(EVENT_DATE, 5),
        credits: 100,
        charges: null,
        flowType: 'INCOME',
      },
    ]);

    await expect(service.classifyBatch(CONDOMINIUM_ID, BATCH_ID)).resolves.toMatchObject({
      total: 1,
    });
  });
});

describe('extractFromBanBajio — BanBajío unit extraction', () => {
  const BANBAJIO_DESC =
    'SPEI Recibido | Concepto del Pago: 106 noviembre | Recibo # 227120243';

  it('extracts the leading unit number from the "Concepto del Pago" segment', () => {
    const result = extractFromBanBajio(BANBAJIO_DESC, 370);
    expect(result.unitNumberDetected).toBe('106');
    expect(result.unitConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('tolerates leading zeros ("06" -> "6")', () => {
    const result = extractFromBanBajio(
      'Concepto del Pago: 06 diciembre | Recibo # 1',
      370,
    );
    expect(result.unitNumberDetected).toBe('6');
  });

  it('rejects a number above the condominium unit count (totalUnits)', () => {
    // 999 > 370 → not a valid unit, must not be detected.
    const result = extractFromBanBajio(
      'Concepto del Pago: 999 enero | Recibo # 5',
      370,
    );
    expect(result.unitNumberDetected).toBeNull();
  });

  it('does not extract when totalUnits is not configured (0)', () => {
    const result = extractFromBanBajio(BANBAJIO_DESC, 0);
    expect(result.unitNumberDetected).toBeNull();
  });

  it('does not borrow the generic unit guess (e.g. casa N / Recibo #) when there is no segment', () => {
    // For BanBajío the unit comes ONLY from the "Concepto del Pago" segment, so a
    // stray "casa 12" must NOT be treated as the unit — but the concept still is.
    const desc = 'SPEI Recibido casa 12 mantenimiento';
    const result = extractFromBanBajio(desc, 370);
    expect(result.unitNumberDetected).toBeNull();
    expect(result.paymentConcept).toBe(extractFromText(desc).paymentConcept);
  });
});

describe('ClassificationService.classifyTransaction — bank-aware extraction', () => {
  const residents = [
    { id: 'res-106', unitNumber: '106', firstName: 'Ana', lastName: 'Sandoval' },
  ];
  const BANBAJIO_DESC =
    'SPEI Recibido | Concepto del Pago: 106 noviembre | Recibo # 227120243';
  const banBajioCtx = { bankName: 'BanBajío', totalUnits: 370 };

  it('links the resident when the bank is BanBajío and the unit exists', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      BANBAJIO_DESC,
      new Date('2025-11-30T12:00:00Z'),
      residents,
      [],
      undefined,
      banBajioCtx,
    );
    expect(result.unitNumberDetected).toBe('106');
    expect(result.residentId).toBe('res-106');
    expect(result.matchSource).toBe(MatchSource.AUTO_UNIT_NUMBER);
    expect(result.classificationStatus).toBe(ClassificationStatus.AUTO);
  });

  it('does NOT extract a bare number for a non-BanBajío bank', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      BANBAJIO_DESC,
      new Date('2025-11-30T12:00:00Z'),
      residents,
      [],
      undefined,
      { bankName: 'BBVA', totalUnits: 370 },
    );
    expect(result.unitNumberDetected).toBeNull();
    expect(result.residentId).toBeNull();
    expect(result.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
  });

  it('still links the resident when a concept rule also fires (BanBajío)', () => {
    const service = makeService(makePrismaMock());
    const rules = [
      {
        id: 'rule-mtto',
        keywords: ['concepto del pago'],
        unitPatterns: [],
        conceptType: 'MAINTENANCE',
        confidenceThreshold: 0.85,
      },
    ] as never;
    const result = service.classifyTransaction(
      BANBAJIO_DESC,
      new Date('2025-11-30T12:00:00Z'),
      residents,
      rules,
      undefined,
      banBajioCtx,
    );
    expect(result.paymentConcept).toBe('MAINTENANCE');
    expect(result.residentId).toBe('res-106');
    expect(result.matchedRuleId).toBe('rule-mtto');
    expect(result.classificationStatus).toBe(ClassificationStatus.AUTO);
  });

  it('marks UNIT_NOT_FOUND when the BanBajío unit has no matching resident', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      'Concepto del Pago: 200 enero | Recibo # 9',
      new Date('2025-11-30T12:00:00Z'),
      residents,
      [],
      undefined,
      banBajioCtx,
    );
    expect(result.unitNumberDetected).toBe('200');
    expect(result.residentId).toBeNull();
    expect(result.requiresReviewReason).toBe(RequiresReviewReason.UNIT_NOT_FOUND);
  });
});

describe('classifyTransaction — EXPENSE rules', () => {
  const EXPENSE_DESC =
    'SPEI Enviado | Beneficiario: RAMCAR NET | Concepto del Pago: Servicios de Vigilancia por (25,987.50) mxn';

  const expenseRule = [
    {
      id: 'rule-vig',
      ruleKind: ReconciliationRuleKind.EXPENSE,
      keywords: ['servicios de vigilancia'],
      unitPatterns: [],
      conceptType: null,
      assignedUnitNumber: null,
      unitExtractionPattern: null,
      unitExtractionGroup: null,
      expenseCategoryId: 'cat-security',
      supplierId: 'sup-ramcar',
      confidenceThreshold: 0.85,
    },
  ] as never;

  it('stamps category + supplier on a matched EXPENSE transaction', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      EXPENSE_DESC,
      new Date('2025-11-29T12:00:00Z'),
      [],
      expenseRule,
      undefined,
      undefined,
      undefined,
      FlowType.EXPENSE,
    );
    expect(result.expenseCategoryId).toBe('cat-security');
    expect(result.supplierId).toBe('sup-ramcar');
    expect(result.matchedRuleId).toBe('rule-vig');
    expect(result.matchSource).toBe(MatchSource.RULE);
    expect(result.residentId).toBeNull();
    expect(result.classificationStatus).toBe(ClassificationStatus.AUTO);
  });

  it('does NOT fire an EXPENSE rule on an INCOME transaction', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      EXPENSE_DESC,
      new Date('2025-11-29T12:00:00Z'),
      [],
      expenseRule,
      undefined,
      undefined,
      undefined,
      FlowType.INCOME,
    );
    expect(result.expenseCategoryId ?? null).toBeNull();
    expect(result.supplierId ?? null).toBeNull();
    expect(result.matchedRuleId).toBeNull();
  });

  it('does NOT fire a CONCEPT rule on an EXPENSE transaction', () => {
    const service = makeService(makePrismaMock());
    const conceptRule = [
      {
        id: 'rule-util',
        ruleKind: ReconciliationRuleKind.CONCEPT,
        keywords: ['servicios de vigilancia'],
        unitPatterns: [],
        conceptType: 'UTILITY',
        assignedUnitNumber: null,
        unitExtractionPattern: null,
        unitExtractionGroup: null,
        expenseCategoryId: null,
        supplierId: null,
        confidenceThreshold: 0.85,
      },
    ] as never;
    const result = service.classifyTransaction(
      EXPENSE_DESC,
      new Date('2025-11-29T12:00:00Z'),
      [],
      conceptRule,
      undefined,
      undefined,
      undefined,
      FlowType.EXPENSE,
    );
    expect(result.matchedRuleId).toBeNull();
    expect(result.expenseCategoryId ?? null).toBeNull();
  });
});

describe('parseMaintenanceConcept — month + unit in any order', () => {
  const seg = (s: string) => `SPEI Recibido | Concepto del Pago: ${s} | Recibo # 1`;

  it('reads "DIC 355" (month before bare unit)', () => {
    expect(parseMaintenanceConcept(seg('DIC 355'), 370)).toEqual({ unit: '355', month: 12 });
  });

  it('reads "Enero casa 120" (prefixed unit)', () => {
    expect(parseMaintenanceConcept(seg('Enero casa 120'), 370)).toEqual({ unit: '120', month: 1 });
  });

  it('reads "Mantenimiento febrero 88"', () => {
    expect(parseMaintenanceConcept(seg('Mantenimiento febrero 88'), 370)).toEqual({ unit: '88', month: 2 });
  });

  it('reads "355 noviembre" (unit before month)', () => {
    expect(parseMaintenanceConcept(seg('355 noviembre'), 370)).toEqual({ unit: '355', month: 11 });
  });

  it('rejects a unit above totalUnits but keeps the month', () => {
    expect(parseMaintenanceConcept(seg('DIC 999'), 370)).toEqual({ unit: null, month: 12 });
  });

  it('returns nulls when there is no "Concepto del Pago" segment', () => {
    expect(parseMaintenanceConcept('SPEI Recibido casa 12', 370)).toEqual({ unit: null, month: null });
  });
});

describe('resolveNearestCycle — advance / late year resolution', () => {
  it('DIC paid in Nov-2025 → Dec-2025 (advance, same year)', () => {
    expect(resolveNearestCycle(12, new Date('2025-11-29T12:00:00Z'))).toEqual({
      paymentPeriodMonth: 12,
      paymentPeriodYear: 2025,
    });
  });

  it('ENE paid in Dec-2025 → Jan-2026 (advance, next year)', () => {
    expect(resolveNearestCycle(1, new Date('2025-12-15T12:00:00Z'))).toEqual({
      paymentPeriodMonth: 1,
      paymentPeriodYear: 2026,
    });
  });

  it('OCT paid in Nov-2025 → Oct-2025 (late, same year)', () => {
    expect(resolveNearestCycle(10, new Date('2025-11-29T12:00:00Z'))).toEqual({
      paymentPeriodMonth: 10,
      paymentPeriodYear: 2025,
    });
  });
});

describe('ClassificationService.classifyTransaction — amount-range maintenance pass', () => {
  const residents = [
    { id: 'res-355', unitNumber: '355', firstName: 'Athziri', lastName: 'Longoria' },
  ];
  const DESC = 'SPEI Recibido | Concepto del Pago: DIC 355 | Recibo # 228564576';
  const TX_DATE = new Date('2025-11-29T12:00:00Z');
  const bankCtx = { bankName: 'BanBajío', totalUnits: 370 };
  const feeCtx = (amount: number) => ({ amount, ordinaryFeeAmount: 500, lateFeeAmount: 100 });

  it('auto-links the resident, sets concept + named-month period (advance payment)', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      DESC, TX_DATE, residents, [], undefined, bankCtx, feeCtx(500),
    );
    expect(result.unitNumberDetected).toBe('355');
    expect(result.residentId).toBe('res-355');
    expect(result.matchSource).toBe(MatchSource.AUTO_AMOUNT_DATE);
    expect(result.classificationStatus).toBe(ClassificationStatus.AUTO);
    expect(result.paymentConcept).toBe('MAINTENANCE');
    // Named month "DIC" → Dec 2025, NOT the Nov transaction month.
    expect(result.paymentPeriodMonth).toBe(12);
    expect(result.paymentPeriodYear).toBe(2025);
  });

  it('accepts the upper bound (ordinary + late surcharge = 600)', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      DESC, TX_DATE, residents, [], undefined, bankCtx, feeCtx(600),
    );
    expect(result.residentId).toBe('res-355');
    expect(result.matchSource).toBe(MatchSource.AUTO_AMOUNT_DATE);
  });

  it('skips the pass when the amount is outside the fee range', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      DESC, TX_DATE, residents, [], undefined, bankCtx, feeCtx(15),
    );
    // Out of range → no maintenance pass → "DIC 355" leading token isn't a number,
    // so no unit is extracted and the row stays in review.
    expect(result.matchSource).not.toBe(MatchSource.AUTO_AMOUNT_DATE);
    expect(result.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
  });

  it('leaves the row in review with concept + period hints when no resident matches', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      DESC, TX_DATE, [], [], undefined, bankCtx, feeCtx(500),
    );
    expect(result.residentId).toBeNull();
    expect(result.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
    // Hints are pre-filled for a one-click approval.
    expect(result.paymentConcept).toBe('MAINTENANCE');
    expect(result.paymentPeriodMonth).toBe(12);
    expect(result.paymentPeriodYear).toBe(2025);
  });
});

describe('extractFromBanBajio — explicit "casa NNN" unit detection', () => {
  const wrap = (s: string) =>
    `SPEI Recibido: | Institucion contraparte: BBVA MEXICO Concepto del Pago: ${s} | Recibo # 228615598`;

  it.each([
    ['casa 176 dic', '176'],
    ['CASA 176 dic', '176'],
    ['mantenimiento casa 191', '191'],
    ['Mantto casa 95 coto Alameda', '95'],
    ['Mmto Anual 2026 Casa 93', '93'], // 93 (the unit), not 2026 (the year)
    ['176 dic', '176'], // leading number still works
    ['casa34', '34'], // glued, no space
    ['casa77manttonoviembre2025', '77'], // glued house + trailing text
    ['CASA233Noviembre2025', '233'], // glued, stops at the first non-digit
  ])('detects the unit in "%s" -> %s', (concept, expected) => {
    expect(extractFromBanBajio(wrap(concept), 370).unitNumberDetected).toBe(expected);
  });

  it('mirrors a single detected unit into unitNumbersDetected', () => {
    expect(extractFromBanBajio(wrap('casa34'), 370).unitNumbersDetected).toEqual(['34']);
  });

  it('does not invent a unit when "casa" is glued to the month with no number', () => {
    expect(extractFromBanBajio(wrap('CASADiciembre2025'), 370).unitNumberDetected).toBeNull();
  });

  it('rejects a prefixed number above totalUnits', () => {
    expect(extractFromBanBajio(wrap('casa 999 dic'), 370).unitNumberDetected).toBeNull();
  });
});

describe('ClassificationService.classifyTransaction — BanBajío unit detection (amount-gated)', () => {
  const residents = [
    { id: 'res-176', unitNumber: '176', firstName: 'Nayeli', lastName: 'Sanchez' },
  ];
  const DESC = 'SPEI Recibido: | Concepto del Pago: casa 176 dic | Recibo # 228615598';
  const TX_DATE = new Date('2025-11-30T12:00:00Z');
  const bankCtx = { bankName: 'BanBajío', totalUnits: 370 };
  const feeCtx = (amount: number) => ({ amount, ordinaryFeeAmount: 500, lateFeeAmount: 100 });

  it('shows the unit but stays in review when the amount is unusual (regla 2)', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      DESC, TX_DATE, residents, [], undefined, bankCtx, feeCtx(100), // $100, out of [500,600]
    );
    expect(result.unitNumberDetected).toBe('176'); // column populated
    expect(result.residentId).toBeNull();           // NOT auto-linked
    expect(result.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
  });

  it('auto-classifies via the fee rule when the amount matches (regla 1, no regression)', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      DESC, TX_DATE, residents, [], undefined, bankCtx, feeCtx(500), // $500 = ordinary fee
    );
    expect(result.unitNumberDetected).toBe('176');
    expect(result.residentId).toBe('res-176');
    expect(result.matchSource).toBe(MatchSource.AUTO_AMOUNT_DATE);
    expect(result.classificationStatus).toBe(ClassificationStatus.AUTO);
  });

  it('stays in review with no unit when the concept has none (regla 3)', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      'SPEI Recibido: | Concepto del Pago: pago | Recibo # 1',
      TX_DATE, residents, [], undefined, bankCtx, feeCtx(100),
    );
    expect(result.unitNumberDetected).toBeNull();
    expect(result.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
  });
});

describe('extractFromBanBajio — multi-unit detection ("casas 307 y 43")', () => {
  const wrap = (s: string) =>
    `SPEI Recibido: | Concepto del Pago: ${s} | Recibo # 225317405`;

  it.each([
    ['casas 307 y 43', ['307', '43']],
    ['casa 307 y 43', ['307', '43']],
    ['casa 307, 43', ['307', '43']],
    ['casa 307 y casa 43', ['307', '43']],
    ['casas 307 & 43', ['307', '43']],
  ])('detects all units in "%s"', (concept, expected) => {
    const r = extractFromBanBajio(wrap(concept), 370);
    expect(r.unitNumbersDetected).toEqual(expected);
  });

  it('leaves the scalar unit null for a multi-unit concept (no 1:1 link)', () => {
    expect(extractFromBanBajio(wrap('casas 307 y 43'), 370).unitNumberDetected).toBeNull();
  });

  it('skips out-of-range houses and 4-digit years, dedupes repeats', () => {
    // 999 > 370 (dropped); 2025 is a year (skipped); the repeat collapses.
    expect(extractFromBanBajio(wrap('casas 307 y 999'), 370).unitNumbersDetected).toEqual(['307']);
    expect(extractFromBanBajio(wrap('casa 5 y 5'), 370).unitNumbersDetected).toEqual(['5']);
  });
});

describe('ClassificationService.classifyTransaction — multi-unit never auto-classifies', () => {
  const residents = [
    { id: 'res-307', unitNumber: '307', firstName: 'Ramon', lastName: 'Banuelos' },
    { id: 'res-43', unitNumber: '43', firstName: 'Rosa', lastName: 'Martinez' },
  ];
  const DESC = 'SPEI Recibido: | Concepto del Pago: casas 307 y 43 | Recibo # 225317405';
  const TX_DATE = new Date('2025-11-30T12:00:00Z');
  const bankCtx = { bankName: 'BanBajío', totalUnits: 370 };
  const feeCtx = (amount: number) => ({ amount, ordinaryFeeAmount: 500, lateFeeAmount: 100 });

  it('surfaces all units but stays in review even when the amount matches the fee', () => {
    const service = makeService(makePrismaMock());
    // $500 = ordinary fee: a single-unit payment WOULD auto-classify here. A
    // multi-unit one must not — there is no single resident to link.
    const result = service.classifyTransaction(
      DESC, TX_DATE, residents, [], undefined, bankCtx, feeCtx(500),
    );
    expect(result.unitNumbersDetected).toEqual(['307', '43']);
    expect(result.unitNumberDetected).toBeNull();
    expect(result.residentId).toBeNull();
    expect(result.matchSource).toBeNull();
    expect(result.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
  });
});

describe('ClassificationService.manualClassify — multi-unit allocations', () => {
  const ALLOC_TX = 'tx-alloc';
  const baseTx = {
    updatedAt: NOW,
    description: 'casas 307 y 43',
    credits: 1000,
    residentId: null,
    unitNumberDetected: null,
    unitNumbersDetected: ['307', '43'],
    paymentConcept: null,
    paymentPeriodMonth: 11,
    paymentPeriodYear: 2025,
    transactionDate: NOW,
    matchSource: null,
    classificationStatus: ClassificationStatus.NEEDS_REVIEW,
    requiresReviewReason: RequiresReviewReason.NO_MATCH,
    matchedRuleId: null,
    paymentAllocations: [],
  };

  function primeSettings(prisma: PrismaMock) {
    prisma.condominiumSettings.findUnique.mockResolvedValue({
      terraceGlobalKeywords: [],
      totalUnits: 370,
    });
  }

  it('rejects when the allocations do not sum to the credit', async () => {
    const prisma = makePrismaMock();
    primeSettings(prisma);
    prisma.transaction.findFirst.mockResolvedValue(baseTx);
    prisma.resident.findFirst.mockResolvedValue({ id: 'res-307' });
    const service = makeService(prisma);

    let caught: unknown;
    try {
      await service.manualClassify(CONDOMINIUM_ID, ALLOC_TX, {
        allocations: [
          { unitNumber: '307', residentId: 'res-307', allocatedAmount: 400 },
          { unitNumber: '43', residentId: 'res-43', allocatedAmount: 400 }, // 800 ≠ 1000
        ],
      }, USER_ID);
    } catch (err) {
      caught = err;
    }
    expect((caught as { getStatus(): number }).getStatus()).toBe(400);
    expect((caught as { getResponse(): unknown }).getResponse()).toMatchObject({
      code: 'ALLOCATION_SUM_MISMATCH',
    });
    expect(prisma.paymentAllocation.createMany).not.toHaveBeenCalled();
  });

  it('rejects when a resident does not live in the allocated unit', async () => {
    const prisma = makePrismaMock();
    primeSettings(prisma);
    prisma.transaction.findFirst.mockResolvedValue(baseTx);
    prisma.resident.findFirst.mockResolvedValue(null); // resident/unit mismatch
    const service = makeService(prisma);

    let caught: unknown;
    try {
      await service.manualClassify(CONDOMINIUM_ID, ALLOC_TX, {
        allocations: [
          { unitNumber: '307', residentId: 'res-307', allocatedAmount: 500 },
          { unitNumber: '43', residentId: 'res-43', allocatedAmount: 500 },
        ],
      }, USER_ID);
    } catch (err) {
      caught = err;
    }
    expect((caught as { getStatus(): number }).getStatus()).toBe(400);
    expect((caught as { getResponse(): unknown }).getResponse()).toMatchObject({
      code: 'ALLOCATION_RESIDENT_UNIT_MISMATCH',
    });
  });

  it('writes one allocation per unit and leaves the tx without a single resident', async () => {
    const prisma = makePrismaMock();
    primeSettings(prisma);
    prisma.transaction.findFirst.mockResolvedValue(baseTx);
    prisma.resident.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id }),
    );
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    const service = makeService(prisma);

    await service.manualClassify(CONDOMINIUM_ID, ALLOC_TX, {
      allocations: [
        { unitNumber: '307', residentId: 'res-307', allocatedAmount: 500 },
        { unitNumber: '43', residentId: 'res-43', allocatedAmount: 500 },
      ],
    }, USER_ID);

    // Re-edit safety: prior allocations are wiped before the new set is written.
    expect(prisma.paymentAllocation.deleteMany).toHaveBeenCalledWith({
      where: { transactionId: ALLOC_TX },
    });
    const created = prisma.paymentAllocation.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(created.map((a: { unitNumber: string }) => a.unitNumber)).toEqual(['307', '43']);
    // The transaction itself keeps no single residentId (split across units).
    expect(prisma.transaction.updateMany.mock.calls[0][0].data).toMatchObject({
      residentId: null,
      unitNumberDetected: null,
      unitNumbersDetected: ['307', '43'],
      classificationStatus: ClassificationStatus.MANUAL_OVERRIDE,
    });
  });
});

describe('extractFromText — maintenance abbreviations', () => {
  it.each([
    ['Pago Mtto noviembre', 'MAINTENANCE'],
    ['MTTO casa 12', 'MAINTENANCE'],
    ['Mmto Anual 2026', 'MAINTENANCE'],
    ['Mantto octubre', 'MAINTENANCE'],
    ['mantenimiento octubre', 'MAINTENANCE'],
    ['Pago mto 344', 'MAINTENANCE'],
    ['mto noviembre', 'MAINTENANCE'],
  ])('tags "%s" as %s', (desc, concept) => {
    expect(extractFromText(desc).paymentConcept).toBe(concept);
  });
});

describe('extractFromBanBajio — maintenance concept + bare unit (Mtto / months)', () => {
  const wrap = (s: string) =>
    `SPEI Recibido: | Institucion contraparte: NU MEXICO Concepto del Pago: ${s} | Recibo # 225199849`;

  it.each([
    ['Mtto Oct 357', '357'],
    ['Mtto 357 Sep', '357'],
    ['MTTO COTO ALAMEDA 218 NOVIEMBRE', '218'],
    ['mto 344', '344'],
  ])('detects a maintenance bare unit in "%s" -> %s', (concept, unit) => {
    const r = extractFromBanBajio(wrap(concept), 370);
    expect(r.paymentConcept).toBe('MAINTENANCE');
    expect(r.unitNumberDetected).toBe(unit);
    expect(r.unitNumbersDetected).toEqual([unit]);
  });

  it('tags a months-only concept as maintenance with no unit ("agosto y octubre")', () => {
    const r = extractFromBanBajio(wrap('agosto y octubre'), 370);
    expect(r.paymentConcept).toBe('MAINTENANCE');
    expect(r.unitNumberDetected).toBeNull();
    expect(r.unitNumbersDetected).toEqual([]);
  });

  it('does NOT take a bare number when the concept is not maintenance (no regression)', () => {
    // "deposito 50" -> DEPOSIT; the bare number must stay un-extracted.
    const r = extractFromBanBajio(wrap('deposito 50'), 370);
    expect(r.paymentConcept).toBe('DEPOSIT');
    expect(r.unitNumberDetected).toBeNull();
  });

  it('does not let a month override a stronger concept keyword', () => {
    // "garantia noviembre 50" -> DEPOSIT (garantia), so the bare 50 is not taken.
    const r = extractFromBanBajio(wrap('garantia noviembre 50'), 370);
    expect(r.paymentConcept).toBe('DEPOSIT');
    expect(r.unitNumberDetected).toBeNull();
  });
});

describe('ClassificationService.classifyTransaction — maintenance concept paints unit, stays in review', () => {
  const residents = [
    { id: 'res-357', unitNumber: '357', firstName: 'Andrea', lastName: 'Bravo' },
  ];
  const TX_DATE = new Date('2025-11-30T12:00:00Z');
  const bankCtx = { bankName: 'BanBajío', totalUnits: 370 };
  const feeCtx = (amount: number) => ({ amount, ordinaryFeeAmount: 500, lateFeeAmount: 100 });

  it('paints concept + unit but stays NEEDS_REVIEW when the amount is unusual', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      'SPEI Recibido: | Concepto del Pago: Mtto Oct 357 | Recibo # 225199849',
      TX_DATE, residents, [], undefined, bankCtx, feeCtx(357), // $357, out of [500,600]
    );
    expect(result.paymentConcept).toBe('MAINTENANCE');
    expect(result.unitNumberDetected).toBe('357');
    expect(result.residentId).toBeNull();
    expect(result.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
  });

  it('paints "mto 344" as maintenance + unit 344, stays NEEDS_REVIEW (amount below the fee)', () => {
    const service = makeService(makePrismaMock());
    const result = service.classifyTransaction(
      'SPEI Recibido: | Concepto del Pago: mto 344 | Recibo # 224562369',
      TX_DATE, residents, [], undefined, bankCtx, feeCtx(400), // $400, out of [500,600], no resident 344
    );
    expect(result.paymentConcept).toBe('MAINTENANCE');
    expect(result.unitNumberDetected).toBe('344');
    expect(result.residentId).toBeNull();
    expect(result.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
  });
});

describe('ClassificationService.getSystemRulesCatalog — transparency catalog', () => {
  const service = makeService(makePrismaMock());
  const catalog = service.getSystemRulesCatalog();

  it('exposes the six concepts in engine order, MAINTENANCE listing "mto"', () => {
    expect(catalog.conceptPatterns.map((c) => c.concept)).toEqual([
      'MAINTENANCE',
      'DEPOSIT',
      'FINE',
      'UTILITY',
      'PARKING',
      'AMENITY',
    ]);
    const maintenance = catalog.conceptPatterns.find((c) => c.concept === 'MAINTENANCE');
    expect(maintenance?.terms).toEqual(
      expect.arrayContaining(['mantenimiento', 'mtto', 'mmto', 'mant', 'mto']),
    );
  });

  it('exposes the unit prefixes and behavioral passes the engine actually runs', () => {
    expect(catalog.unitPatterns.map((u) => u.label)).toEqual(['casa', 'unidad', 'lote', 'c.', 'depto', '#']);
    expect(catalog.behavioralPasses.map((p) => p.key)).toEqual([
      'terraceBooking',
      'amountGate',
      'banbajioSegment',
      'multiHouseSplit',
      'monthToMaintenance',
      'fuzzyName',
    ]);
  });

  it('surfaces 12 months and cleans the internal "may_" key to "may"', () => {
    expect(catalog.months).toHaveLength(12);
    const may = catalog.months.find((m) => m.month === 5);
    expect(may?.forms).toContain('may');
    expect(may?.forms).not.toContain('may_');
  });

  // GUARD (anti-drift): every documented concept term, run through the REAL
  // extractor, must still resolve to its concept. If someone edits a CONCEPT_PATTERNS
  // regex and breaks a term the catalog advertises, this fails in CI — the catalog
  // can never silently lie about what the engine recognizes.
  it('every documented concept term is actually detected by the engine', () => {
    for (const { concept, terms } of catalog.conceptPatterns) {
      for (const term of terms) {
        expect(extractFromText(term).paymentConcept).toBe(concept);
      }
    }
  });

  // GUARD (anti-drift): every documented unit example must yield a detected unit
  // through the real extractor.
  it('every documented unit example is actually detected by the engine', () => {
    for (const { example } of catalog.unitPatterns) {
      expect(extractFromText(example).unitNumberDetected).not.toBeNull();
    }
  });
});

function unitRule(partial: Partial<DbRule>): DbRule {
  return {
    id: 'rule-1',
    ruleKind: ReconciliationRuleKind.UNIT,
    keywords: [],
    unitPatterns: [],
    conceptType: null,
    assignedUnitNumber: null,
    unitExtractionPattern: null,
    unitExtractionGroup: null,
    expenseCategoryId: null,
    supplierId: null,
    confidenceThreshold: 0.9 as unknown as DbRule['confidenceThreshold'],
    ...partial,
  };
}

describe('resolveRuleUnit — UNIT rule outcome resolution', () => {
  it('returns null for a CONCEPT rule', () => {
    const rule = unitRule({ ruleKind: ReconciliationRuleKind.CONCEPT, assignedUnitNumber: '5' });
    expect(resolveRuleUnit(rule, 'casa 5 mantenimiento')).toBeNull();
  });

  it('returns the fixed unit for a direct-assignment rule', () => {
    const rule = unitRule({ assignedUnitNumber: '34' });
    expect(resolveRuleUnit(rule, 'transferencia juan perez')).toBe('34');
  });

  it('extracts the configured capture group for a format rule', () => {
    const rule = unitRule({ unitExtractionPattern: 'apt-(\\d+)', unitExtractionGroup: 1 });
    expect(resolveRuleUnit(rule, 'pago APT-305 cuota')).toBe('305');
  });

  it('defaults the capture group to 1 when unset', () => {
    const rule = unitRule({ unitExtractionPattern: 'torre [a-z]-(\\d+)' });
    expect(resolveRuleUnit(rule, 'pago torre b-12')).toBe('12');
  });

  it('returns null when the extraction pattern does not match', () => {
    const rule = unitRule({ unitExtractionPattern: 'apt-(\\d+)' });
    expect(resolveRuleUnit(rule, 'pago casa 5')).toBeNull();
  });

  it('degrades to null on an invalid regex instead of throwing', () => {
    const rule = unitRule({ unitExtractionPattern: '([unterminated' });
    expect(resolveRuleUnit(rule, 'anything')).toBeNull();
  });

  it('refuses an over-long pattern (runtime ReDoS backstop)', () => {
    const rule = unitRule({ unitExtractionPattern: `a(${'b'.repeat(300)})` });
    expect(resolveRuleUnit(rule, 'a' + 'b'.repeat(300))).toBeNull();
  });

  it('matches a catastrophic-backtracking pattern in linear time (RE2, no hang)', () => {
    // Under the JS backtracker this input would hang for seconds; RE2 runs it
    // in linear time. We assert it both returns promptly and matches correctly.
    const rule = unitRule({ unitExtractionPattern: '(a+)+-(\\d+)', unitExtractionGroup: 2 });
    const adversarial = `${'a'.repeat(40)}-7`;
    const start = Date.now();
    expect(resolveRuleUnit(rule, adversarial)).toBe('7');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('degrades to null on an RE2-unsupported pattern (lookahead) instead of throwing', () => {
    const rule = unitRule({ unitExtractionPattern: '(?=apt)apt-(\\d+)' });
    expect(resolveRuleUnit(rule, 'pago apt-9')).toBeNull();
  });
});

describe('ClassificationService.classifyBatch — UNIT-kind reconciliation rules', () => {
  function setupRuleBatch(
    prisma: PrismaMock,
    residents: Array<{ id: string; unitNumber: string; firstName: string; lastName: string }>,
    description: string,
  ): void {
    prisma.resident.findMany.mockResolvedValue(residents);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        description,
        transactionDate: EVENT_DATE,
        credits: 1500,
        charges: null,
        flowType: 'INCOME',
      },
    ]);
  }

  it('direct-assignment rule links the resident and auto-classifies', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, [
      unitRule({ keywords: ['juan perez'], assignedUnitNumber: '5' }),
    ]);
    setupRuleBatch(
      prisma,
      [{ id: 'res-1', unitNumber: '5', firstName: 'Juan', lastName: 'Perez' }],
      'transferencia juan perez sin referencia',
    );

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.unitNumberDetected).toBe('5');
    expect(data!.residentId).toBe('res-1');
    expect(data!.classificationStatus).toBe(ClassificationStatus.AUTO);
    expect(data!.matchSource).toBe(MatchSource.AUTO_UNIT_NUMBER);
    expect(data!.matchedRuleId).toBe('rule-1');
  });

  it('format-extraction rule captures the unit and links the resident (APT-305)', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, [
      unitRule({ unitExtractionPattern: 'apt-(\\d+)', unitExtractionGroup: 1 }),
    ]);
    setupRuleBatch(
      prisma,
      [{ id: 'res-7', unitNumber: '305', firstName: 'Ana', lastName: 'Soto' }],
      'pago APT-305 cuota',
    );

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.unitNumberDetected).toBe('305');
    expect(data!.residentId).toBe('res-7');
    expect(data!.classificationStatus).toBe(ClassificationStatus.AUTO);
    expect(data!.matchedRuleId).toBe('rule-1');
  });

  it('leaves the row in review (UNIT_NOT_FOUND) when the assigned unit is absent from the padrón', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, [
      unitRule({ keywords: ['juan perez'], assignedUnitNumber: '99' }),
    ]);
    setupRuleBatch(
      prisma,
      [{ id: 'res-1', unitNumber: '5', firstName: 'Juan', lastName: 'Perez' }],
      'transferencia juan perez sin referencia',
    );

    await service.classifyBatch(CONDOMINIUM_ID, BATCH_ID);

    const data = findClassifierUpdate(prisma.transaction.updateMany, 'tx-1');
    expect(data).toBeDefined();
    expect(data!.unitNumberDetected).toBe('99');
    expect(data!.residentId).toBeNull();
    expect(data!.classificationStatus).toBe(ClassificationStatus.NEEDS_REVIEW);
    expect(data!.requiresReviewReason).toBe(RequiresReviewReason.UNIT_NOT_FOUND);
  });
});
