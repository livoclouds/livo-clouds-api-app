import * as Sentry from '@sentry/nestjs';
import { CalendarReclassifyService } from './calendar-reclassify.service';
import type { CalendarTerraceChangedPayload } from '../events/calendar-terrace-changed.event';

// CAL-073: assert the give-up path raises an alertable Sentry signal. Auto-mock
// turns every export into a jest.fn() (a no-op without SENTRY_DSN in any case).
jest.mock('@sentry/nestjs');

const CONDOMINIUM_ID = 'cond-1';
const EVENT_ID = 'evt-1';
const ACTOR_ID = 'user-1';

interface PrismaMock {
  transaction: { findMany: jest.Mock };
  // CAL-074: fallback-actor lookup resolves the triggering event's creator.
  calendarEvent: { findUnique: jest.Mock };
  // Interactive $transaction — wraps each batch's cross-replica advisory lock.
  $transaction: jest.Mock;
}
interface ClassificationMock {
  reclassifyBatch: jest.Mock;
}
interface AuditMock {
  log: jest.Mock;
}

function makePrismaMock(
  rows: Array<{ importBatchId: string }> = [],
  lockAcquired = true,
): PrismaMock {
  return {
    transaction: { findMany: jest.fn().mockResolvedValue(rows) },
    // Default: no fallback actor resolvable (event absent) — tests that exercise
    // CAL-074's fallback override this to return a createdById.
    calendarEvent: { findUnique: jest.fn().mockResolvedValue(null) },
    // Default: the per-batch advisory lock is granted, so the wrapped
    // reclassifyBatch runs. Pass lockAcquired=false to simulate a peer replica.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: jest.fn().mockResolvedValue([{ locked: lockAcquired }]) }),
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});
function makeClassificationMock(): ClassificationMock {
  return { reclassifyBatch: jest.fn().mockResolvedValue({ total: 0, classified: 0, needsReview: 0, unmatched: 0 }) };
}
function makeAuditMock(): AuditMock {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeService(
  prisma: PrismaMock,
  classification: ClassificationMock,
  audit: AuditMock = makeAuditMock(),
): CalendarReclassifyService {
  return new CalendarReclassifyService(prisma as never, classification as never, audit as never);
}

function payload(overrides: Partial<CalendarTerraceChangedPayload> = {}): CalendarTerraceChangedPayload {
  return {
    condominiumId: CONDOMINIUM_ID,
    triggeringEventId: EVENT_ID,
    action: 'create',
    windowStart: new Date('2026-05-15T00:00:00Z'),
    windowEnd: new Date('2026-06-15T00:00:00Z'),
    reason: 'create',
    actorUserId: ACTOR_ID,
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
    expect(classification.reclassifyBatch).toHaveBeenCalledWith(CONDOMINIUM_ID, 'batch-A', null);
    expect(classification.reclassifyBatch).toHaveBeenCalledWith(CONDOMINIUM_ID, 'batch-B', null);
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

  it('narrows affected batches to reset-eligible rows only (CAL-072)', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }]);
    const service = makeService(prisma, makeClassificationMock());

    await service.run(payload());

    // Mirrors reclassifyBatch's resetScope so settled/manual rows can't requeue
    // a batch that the re-run would leave untouched.
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.classificationStatus).toEqual({ not: 'MANUAL_OVERRIDE' });
    expect(where.reconciliationStatus).toBe('PENDING');
  });

  it('requeues a batch when the cross-replica advisory lock is not acquired (CAL-059)', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }], false); // peer holds the lock
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);
    const scheduleSpy = jest
      .spyOn(service as unknown as { scheduleRequeue: () => void }, 'scheduleRequeue')
      .mockImplementation(() => undefined);

    await service.run(payload());

    // The engine never double-runs — the batch is requeued, not reclassified.
    expect(classification.reclassifyBatch).not.toHaveBeenCalled();
    expect(scheduleSpy).toHaveBeenCalledWith(expect.anything(), ['batch-A'], 1);
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

  it('requeues a batch already in-flight instead of dropping it (CAL-033)', async () => {
    const prisma = makePrismaMock([
      { importBatchId: 'batch-A' },
      { importBatchId: 'batch-B' },
    ]);
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);
    // Don't run real timers — assert the requeue was scheduled, not dropped.
    const scheduleSpy = jest
      .spyOn(service as unknown as { scheduleRequeue: () => void }, 'scheduleRequeue')
      .mockImplementation(() => undefined);

    // Pre-seed the in-flight set: same key the service computes.
    (service as unknown as { inFlight: Set<string> }).inFlight.add(`${CONDOMINIUM_ID}:batch-A`);

    await service.run(payload());

    // batch-B still runs immediately…
    expect(classification.reclassifyBatch).toHaveBeenCalledTimes(1);
    expect(classification.reclassifyBatch).toHaveBeenCalledWith(CONDOMINIUM_ID, 'batch-B', null);
    // …and batch-A is requeued (attempt 1), not silently skipped.
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith(expect.anything(), ['batch-A'], 1);
  });

  it('writes a system-attributed audit row for the engine-triggered run (CAL-039)', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }]);
    const classification = makeClassificationMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, classification, audit);

    await service.run(payload({ reason: 'update:metadata', action: 'update' }));

    expect(audit.log).toHaveBeenCalledTimes(1);
    const row = audit.log.mock.calls[0][0];
    expect(row.userId).toBe(ACTOR_ID);
    expect(row.action).toBe('CALENDAR_AUTO_RECLASSIFY');
    expect(row.module).toBe('calendar');
    expect(row.entityId).toBe(EVENT_ID);
    expect(row.afterState.triggeredBy).toBe('system-reclassify');
    expect(row.afterState.succeeded).toBe(1);
  });

  it('falls back to the triggering event creator when no actor rode in on the payload (CAL-074)', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }]);
    prisma.calendarEvent.findUnique.mockResolvedValue({ createdById: 'creator-9' });
    const classification = makeClassificationMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, classification, audit);

    await service.run(payload({ actorUserId: null }));

    // The run is still audited — attributed to the FK-safe fallback actor.
    expect(prisma.calendarEvent.findUnique).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      select: { createdById: true },
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
    const row = audit.log.mock.calls[0][0];
    expect(row.userId).toBe('creator-9');
    expect(row.afterState.triggeredBy).toBe('system-reclassify');
  });

  it('skips the audit row only when the fallback actor is also unresolvable (CAL-074)', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }]); // findUnique → null
    const classification = makeClassificationMock();
    const audit = makeAuditMock();
    const service = makeService(prisma, classification, audit);

    await service.run(payload({ actorUserId: null }));

    expect(classification.reclassifyBatch).toHaveBeenCalledTimes(1);
    expect(prisma.calendarEvent.findUnique).toHaveBeenCalledTimes(1);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('does not look up a fallback actor when the payload already carries one (CAL-074)', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }]);
    const audit = makeAuditMock();
    const service = makeService(prisma, makeClassificationMock(), audit);

    await service.run(payload());

    expect(prisma.calendarEvent.findUnique).not.toHaveBeenCalled();
    expect(audit.log.mock.calls[0][0].userId).toBe(ACTOR_ID);
  });

  it('raises an alertable Sentry signal when it gives up requeueing a contended batch (CAL-073)', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }], false); // peer holds the lock
    const classification = makeClassificationMock();
    const service = makeService(prisma, classification);

    // Drive processBatches at the terminal attempt: the batch requeues but
    // attempt is no longer < MAX_REQUEUE_ATTEMPTS, so the give-up branch fires.
    await (
      service as unknown as {
        processBatches: (
          p: CalendarTerraceChangedPayload,
          b: string[],
          a: number,
        ) => Promise<unknown>;
      }
    ).processBatches(payload(), ['batch-A'], 3);

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [, options] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(options.level).toBe('warning');
    expect(options.tags.condominiumId).toBe(CONDOMINIUM_ID);
    expect(options.extra.triggeringEventId).toBe(EVENT_ID);
    expect(options.extra.attempts).toBe(3);
  });

  it('does not raise the give-up Sentry signal while attempts remain (CAL-073)', async () => {
    const prisma = makePrismaMock([{ importBatchId: 'batch-A' }], false);
    const service = makeService(prisma, makeClassificationMock());
    jest
      .spyOn(service as unknown as { scheduleRequeue: () => void }, 'scheduleRequeue')
      .mockImplementation(() => undefined);

    await service.run(payload()); // attempt 0 — requeues, doesn't give up

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
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
