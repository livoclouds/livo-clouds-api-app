import { CalendarReclassifyService } from './calendar-reclassify.service';
import type { CalendarTerraceChangedPayload } from '../events/calendar-terrace-changed.event';

const CONDOMINIUM_ID = 'cond-1';
const EVENT_ID = 'evt-1';

interface PrismaMock {
  transaction: { findMany: jest.Mock };
}
interface ClassificationMock {
  reclassifyBatch: jest.Mock;
}

function makePrismaMock(rows: Array<{ importBatchId: string }> = []): PrismaMock {
  return { transaction: { findMany: jest.fn().mockResolvedValue(rows) } };
}
function makeClassificationMock(): ClassificationMock {
  return { reclassifyBatch: jest.fn().mockResolvedValue({ total: 0, classified: 0, needsReview: 0, unmatched: 0 }) };
}

function makeService(prisma: PrismaMock, classification: ClassificationMock): CalendarReclassifyService {
  return new CalendarReclassifyService(prisma as never, classification as never);
}

function payload(overrides: Partial<CalendarTerraceChangedPayload> = {}): CalendarTerraceChangedPayload {
  return {
    condominiumId: CONDOMINIUM_ID,
    triggeringEventId: EVENT_ID,
    action: 'create',
    windowStart: new Date('2026-05-15T00:00:00Z'),
    windowEnd: new Date('2026-06-15T00:00:00Z'),
    reason: 'create',
    ...overrides,
  };
}

describe('CalendarReclassifyService.run', () => {
  it('calls reclassifyBatch once per distinct importBatchId returned by the window query', async () => {
    const prisma = makePrismaMock([
      { importBatchId: 'batch-A' },
      { importBatchId: 'batch-B' },
    ]);
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);

    await service.run(payload());

    expect(classification.reclassifyBatch).toHaveBeenCalledTimes(2);
    expect(classification.reclassifyBatch).toHaveBeenCalledWith(CONDOMINIUM_ID, 'batch-A');
    expect(classification.reclassifyBatch).toHaveBeenCalledWith(CONDOMINIUM_ID, 'batch-B');
  });

  it('does not call reclassifyBatch when no transactions fall in the window', async () => {
    const prisma = makePrismaMock([]);
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);

    await service.run(payload());

    expect(classification.reclassifyBatch).not.toHaveBeenCalled();
  });

  it('queries only INCOME transactions scoped to the tenant in the window', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }]);
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);

    const p = payload();
    await service.run(p);

    expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.transaction.findMany.mock.calls[0][0];
    expect(arg.where.condominiumId).toBe(CONDOMINIUM_ID);
    expect(arg.where.flowType).toBe('INCOME');
    expect(arg.where.transactionDate).toEqual({ gte: p.windowStart, lte: p.windowEnd });
    expect(arg.distinct).toEqual(['importBatchId']);
  });

  it('continues running remaining batches when one reclassifyBatch throws', async () => {
    const prisma = makePrismaMock([
      { importBatchId: 'batch-A' },
      { importBatchId: 'batch-B' },
    ]);
    const classification = makeClassificationMock();
    classification.reclassifyBatch.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const service = makeService(prisma, classification);

    await service.run(payload());

    expect(classification.reclassifyBatch).toHaveBeenCalledTimes(2);
  });

  it('skips a batch already marked in-flight (best-effort dedupe)', async () => {
    const prisma = makePrismaMock([
      { importBatchId: 'batch-A' },
      { importBatchId: 'batch-B' },
    ]);
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);

    // Pre-seed the in-flight set: same key the service computes.
    (service as unknown as { inFlight: Set<string> }).inFlight.add(`${CONDOMINIUM_ID}:batch-A`);

    await service.run(payload());

    expect(classification.reclassifyBatch).toHaveBeenCalledTimes(1);
    expect(classification.reclassifyBatch).toHaveBeenCalledWith(CONDOMINIUM_ID, 'batch-B');
  });

});

describe('CalendarReclassifyService.handle', () => {
  it('defers reclassify execution off the event-loop tick (handle returns synchronously)', () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }]);
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);

    service.handle(payload());

    // Synchronous check: reclassifyBatch is NOT called yet because run() is
    // queued via setImmediate, not awaited. This guarantees the HTTP response
    // (which fired the emit) has time to flush before reclassify starts.
    expect(classification.reclassifyBatch).not.toHaveBeenCalled();
  });

  it('eventually invokes reclassify after the macrotask drain', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }]);
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);

    service.handle(payload());

    // Drain the macrotask queue twice — once for setImmediate, once for the
    // Prisma findMany microtask resolution.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(classification.reclassifyBatch).toHaveBeenCalledTimes(1);
  });
});
