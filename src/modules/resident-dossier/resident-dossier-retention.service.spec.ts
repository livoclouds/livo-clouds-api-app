import { DossierRetentionService } from './resident-dossier-retention.service';

const CONDO = 'cond-1';

function makeService(over: {
  configs?: { condominiumId: string; dossierRetentionDays: number }[];
  expired?: { id: string; attachments: { storageKey: string }[] }[];
} = {}) {
  const prisma = {
    condominiumSettings: {
      findMany: jest.fn().mockResolvedValue(
        over.configs ?? [{ condominiumId: CONDO, dossierRetentionDays: 30 }],
      ),
    },
    residentDossierEntry: {
      findMany: jest.fn().mockResolvedValue(over.expired ?? []),
      deleteMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: { in: string[] } } }) => ({
          count: where.id.in.length,
        })),
    },
  };
  const storage = { deleteFile: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new DossierRetentionService(
    prisma as never,
    storage as never,
    audit as never,
  );
  return { service, prisma, storage, audit };
}

describe('DossierRetentionService.sweep', () => {
  it('only scans condominiums with auto-purge on AND a positive window', async () => {
    const { service, prisma } = makeService();
    await service.sweep();
    expect(prisma.condominiumSettings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { autopurgeEnabled: true, dossierRetentionDays: { gt: 0 } },
      }),
    );
  });

  it('queries only soft-deleted expired entries and EXCLUDES legal hold', async () => {
    const { service, prisma } = makeService();
    await service.sweep(new Date('2026-06-05T00:00:00Z'));
    const where = prisma.residentDossierEntry.findMany.mock.calls[0][0].where;
    expect(where.deletedAt.not).toBeNull();
    expect(where.deletedAt.lt).toBeInstanceOf(Date);
    // Legal hold: never purge LEGAL category or LEGAL_CONFIDENTIAL confidentiality.
    expect(where.category).toEqual({ not: 'LEGAL' });
    expect(where.confidentiality).toEqual({ not: 'LEGAL_CONFIDENTIAL' });
    expect(where.condominiumId).toBe(CONDO);
  });

  it('hard-deletes expired entries, cleans R2, and audits a per-condo summary', async () => {
    const { service, prisma, storage, audit } = makeService({
      expired: [
        { id: 'e1', attachments: [{ storageKey: 'k1' }, { storageKey: 'k2' }] },
        { id: 'e2', attachments: [] },
      ],
    });
    const res = await service.sweep();
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
    expect(prisma.residentDossierEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1', 'e2'] } },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DOSSIER_RETENTION_PURGED',
        afterState: expect.objectContaining({ entriesPurged: 2, attachmentsPurged: 2 }),
      }),
    );
    expect(res).toMatchObject({ condominiumsScanned: 1, entriesPurged: 2, attachmentsPurged: 2 });
  });

  it('does nothing (no delete, no audit) when no entry is expired', async () => {
    const { service, prisma, audit } = makeService({ expired: [] });
    const res = await service.sweep();
    expect(prisma.residentDossierEntry.deleteMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(res).toMatchObject({ entriesPurged: 0 });
  });

  it('swallows R2 failures (best-effort) and still deletes the row', async () => {
    const { service, prisma, storage } = makeService({
      expired: [{ id: 'e1', attachments: [{ storageKey: 'k1' }] }],
    });
    storage.deleteFile.mockRejectedValueOnce(new Error('R2 down'));
    await expect(service.sweep()).resolves.toMatchObject({ entriesPurged: 1 });
    expect(prisma.residentDossierEntry.deleteMany).toHaveBeenCalled();
  });
});
