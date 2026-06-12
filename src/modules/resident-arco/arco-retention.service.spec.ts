import { ArcoRetentionService } from './arco-retention.service';

const NOW = new Date('2026-06-30T12:00:00.000Z');

function makeService() {
  const prisma = {
    condominiumSettings: { findMany: jest.fn() },
    arcoRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // The purge now wraps deleteMany in a transaction that sets the append-only
    // bypass flag (RP-011); the tx exposes the same arcoRequest client.
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  const storage = { deleteFile: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ArcoRetentionService(
    prisma as never,
    storage as never,
    audit as never,
  );
  return { service, prisma, storage, audit };
}

describe('ArcoRetentionService', () => {
  it('purges resolved requests past the window and their R2 evidence, audited', async () => {
    const { service, prisma, storage, audit } = makeService();
    prisma.condominiumSettings.findMany.mockResolvedValue([
      { condominiumId: 'c1', arcoRetentionMonths: 72 },
    ]);
    prisma.arcoRequest.findMany.mockResolvedValue([
      { id: 'arco-old', attachments: [{ storageKey: 'k1' }, { storageKey: 'k2' }] },
    ]);
    prisma.arcoRequest.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.sweep(NOW);

    expect(result).toEqual({
      condominiumsScanned: 1,
      requestsPurged: 1,
      attachmentsPurged: 2,
    });
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
    expect(prisma.arcoRequest.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['arco-old'] } },
    });
    // Cut-off is 72 months before NOW, terminal statuses only.
    const where = prisma.arcoRequest.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['COMPLETED', 'REJECTED'] });
    expect((where.resolvedAt.lt as Date).getUTCFullYear()).toBe(2020);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ARCO_RETENTION_PURGE' }),
    );
  });

  it('only scans condominiums with autopurge enabled and a positive window', async () => {
    const { service, prisma } = makeService();
    prisma.condominiumSettings.findMany.mockResolvedValue([]);
    const result = await service.sweep(NOW);
    expect(prisma.condominiumSettings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { autopurgeEnabled: true, arcoRetentionMonths: { gt: 0 } },
      }),
    );
    expect(result.requestsPurged).toBe(0);
    expect(prisma.arcoRequest.findMany).not.toHaveBeenCalled();
  });
});
