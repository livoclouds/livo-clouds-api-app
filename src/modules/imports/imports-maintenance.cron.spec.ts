import { ImportsMaintenanceCron } from './imports-maintenance.cron';
import { ABANDONED_PENDING_MS, STALE_PROCESSING_MS } from './imports.constants';

const NOW = new Date('2026-06-12T12:00:00.000Z');

function makeDeps() {
  return {
    prisma: {
      importBatch: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue({}),
      },
    },
    audit: { log: jest.fn().mockResolvedValue(undefined) },
    storage: { deleteFile: jest.fn().mockResolvedValue(undefined) },
  };
}

function makeCron(deps: ReturnType<typeof makeDeps>): ImportsMaintenanceCron {
  return new ImportsMaintenanceCron(
    deps.prisma as never,
    deps.audit as never,
    deps.storage as never,
  );
}

describe('ImportsMaintenanceCron.sweep — stuck-PROCESSING reaper (ENGINE-004)', () => {
  it('flags PROCESSING batches stale beyond the threshold as FAILED with a stall errorMessage and one audit row each', async () => {
    const deps = makeDeps();
    const stalledSince = new Date(NOW.getTime() - STALE_PROCESSING_MS - 60_000);
    deps.prisma.importBatch.findMany
      .mockResolvedValueOnce([
        {
          id: 'batch-stuck',
          condominiumId: 'cond-1',
          importedById: 'user-importer',
          fileName: 'movs.xlsx',
          updatedAt: stalledSince,
        },
      ])
      .mockResolvedValueOnce([]);
    const cron = makeCron(deps);

    const result = await cron.sweep(NOW);

    expect(result).toEqual({ stuckRecovered: 1, orphansPurged: 0 });
    expect(deps.prisma.importBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'batch-stuck', status: 'PROCESSING' }),
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: expect.stringContaining('stalled'),
        }),
      }),
    );
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPORT_FAILED',
        result: 'WARNING',
        entityId: 'batch-stuck',
        // audit_logs.userId is an FK to users — attributed to the importer,
        // with the system trigger recorded in afterState.
        userId: 'user-importer',
        afterState: expect.objectContaining({
          errorCode: 'CLASSIFICATION_STALLED',
          triggeredBy: 'system-reaper',
        }),
      }),
    );
  });

  it('uses a cutoff that leaves fresh PROCESSING batches untouched', async () => {
    const deps = makeDeps();
    const cron = makeCron(deps);

    const result = await cron.sweep(NOW);

    expect(result).toEqual({ stuckRecovered: 0, orphansPurged: 0 });
    const stuckQuery = deps.prisma.importBatch.findMany.mock.calls[0][0];
    expect(stuckQuery.where.status).toBe('PROCESSING');
    expect(stuckQuery.where.updatedAt.lt.getTime()).toBe(
      NOW.getTime() - STALE_PROCESSING_MS,
    );
    expect(deps.prisma.importBatch.updateMany).not.toHaveBeenCalled();
  });

  it('skips the audit row when a concurrent transition already moved the batch on (updateMany count=0)', async () => {
    const deps = makeDeps();
    deps.prisma.importBatch.findMany
      .mockResolvedValueOnce([
        {
          id: 'batch-stuck',
          condominiumId: 'cond-1',
          importedById: 'user-importer',
          fileName: 'movs.xlsx',
          updatedAt: new Date(0),
        },
      ])
      .mockResolvedValueOnce([]);
    deps.prisma.importBatch.updateMany.mockResolvedValue({ count: 0 });
    const cron = makeCron(deps);

    const result = await cron.sweep(NOW);

    expect(result.stuckRecovered).toBe(0);
    expect(deps.audit.log).not.toHaveBeenCalled();
  });
});

describe('ImportsMaintenanceCron.sweep — abandoned-upload purge (ENGINE-048)', () => {
  it('purges abandoned PENDING batches: R2 object deleted, batch row removed, audit row written', async () => {
    const deps = makeDeps();
    deps.prisma.importBatch.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'batch-abandoned',
          condominiumId: 'cond-1',
          importedById: 'user-importer',
          storageKey: 'condominiums/cond-1/imports/batch-abandoned/movs.xlsx',
        },
      ]);
    const cron = makeCron(deps);

    const result = await cron.sweep(NOW);

    expect(result).toEqual({ stuckRecovered: 0, orphansPurged: 1 });
    expect(deps.storage.deleteFile).toHaveBeenCalledWith(
      'condominiums/cond-1/imports/batch-abandoned/movs.xlsx',
    );
    expect(deps.prisma.importBatch.delete).toHaveBeenCalledWith({
      where: { id: 'batch-abandoned' },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPORT_DELETED',
        entityId: 'batch-abandoned',
        afterState: expect.objectContaining({ errorCode: 'IMPORT_BATCH_PURGED' }),
      }),
    );
    // The query itself encodes the guards: PENDING + storageKey + no
    // transactions + older than the abandonment window.
    const purgeQuery = deps.prisma.importBatch.findMany.mock.calls[1][0];
    expect(purgeQuery.where).toMatchObject({
      status: 'PENDING',
      storageKey: { not: null },
      transactions: { none: {} },
    });
    expect(purgeQuery.where.createdAt.lt.getTime()).toBe(
      NOW.getTime() - ABANDONED_PENDING_MS,
    );
  });

  it('keeps the batch row when the R2 delete fails so the next sweep retries', async () => {
    const deps = makeDeps();
    deps.prisma.importBatch.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'batch-abandoned',
          condominiumId: 'cond-1',
          importedById: 'user-importer',
          storageKey: 'condominiums/cond-1/imports/batch-abandoned/movs.xlsx',
        },
      ]);
    deps.storage.deleteFile.mockRejectedValue(new Error('R2 down'));
    const cron = makeCron(deps);

    const result = await cron.sweep(NOW);

    expect(result.orphansPurged).toBe(0);
    expect(deps.prisma.importBatch.delete).not.toHaveBeenCalled();
  });
});

describe('ImportsMaintenanceCron.scheduledSweep', () => {
  it('logs and swallows sweep failures so the scheduler stays healthy', async () => {
    const deps = makeDeps();
    deps.prisma.importBatch.findMany.mockRejectedValue(new Error('db down'));
    const cron = makeCron(deps);

    await expect(cron.scheduledSweep()).resolves.toBeUndefined();
  });
});
