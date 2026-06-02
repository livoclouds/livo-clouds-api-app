import { ImportsService } from './imports.service';

const CONDOMINIUM_ID = 'cond-1';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

interface PrismaMock {
  importBatch: {
    findMany: jest.Mock;
    count?: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    importBatch: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

function makeService(prisma: PrismaMock): ImportsService {
  return new ImportsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('ImportsService.checkHashesForCondominium', () => {
  it('returns the subset of hashes already stored as COMPLETED batches with transactions', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.importBatch.findMany.mockResolvedValueOnce([
      { fileHash: HASH_A, fileName: 'file_a.xlsx', _count: { transactions: 350 } },
      { fileHash: HASH_B, fileName: 'file_b.xlsx', _count: { transactions: 0 } },
    ]);

    const result = await service.checkHashesForCondominium(CONDOMINIUM_ID, [
      HASH_A,
      HASH_B,
      HASH_C,
    ]);

    expect(result).toEqual({
      duplicateHashes: [HASH_A],
      duplicateFiles: [{ hash: HASH_A, fileName: 'file_a.xlsx' }],
    });
    expect(prisma.importBatch.findMany).toHaveBeenCalledWith({
      where: {
        condominiumId: CONDOMINIUM_ID,
        fileHash: { in: [HASH_A, HASH_B, HASH_C] },
        status: 'COMPLETED',
      },
      select: {
        fileHash: true,
        fileName: true,
        _count: { select: { transactions: true } },
      },
    });
  });

  it('returns an empty list when the hashes argument is empty without hitting the DB', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    const result = await service.checkHashesForCondominium(CONDOMINIUM_ID, []);

    expect(result).toEqual({ duplicateHashes: [], duplicateFiles: [] });
    expect(prisma.importBatch.findMany).not.toHaveBeenCalled();
  });

  it('deduplicates hashes when the DB returns multiple rows for the same hash', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.importBatch.findMany.mockResolvedValueOnce([
      { fileHash: HASH_A, fileName: 'file_a.xlsx', _count: { transactions: 100 } },
      { fileHash: HASH_A, fileName: 'file_a.xlsx', _count: { transactions: 50 } },
    ]);

    const result = await service.checkHashesForCondominium(CONDOMINIUM_ID, [HASH_A]);

    expect(result).toEqual({
      duplicateHashes: [HASH_A],
      duplicateFiles: [{ hash: HASH_A, fileName: 'file_a.xlsx' }],
    });
  });
});

describe('ImportsService.confirm — fileHash fallback ordering', () => {
  // When confirm arrives WITHOUT an explicit batchId it falls back to a
  // fileHash lookup. That lookup must order by createdAt desc so the most
  // recently retained batch wins — an unordered findFirst could return an older
  // PENDING/FAILED batch with no storageKey and 409 spuriously.
  function makeConfirmService(findFirst: jest.Mock): ImportsService {
    const prisma = { importBatch: { findFirst } };
    const settings = {
      validateFeesConfigured: jest.fn().mockResolvedValue({ valid: true }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return new ImportsService(
      prisma as never, // prisma
      {} as never, // storage
      {} as never, // classification
      settings as never, // settings
      audit as never, // audit
      {} as never, // parser
      {} as never, // config
      {} as never, // bankProfiles
      {} as never, // events
    );
  }

  const confirmDto = {
    files: [
      {
        fileName: 'movimientos.xlsx',
        fileType: 'xlsx',
        fileHash: HASH_A,
        fileSizeBytes: 1024,
        warnings: [],
        transactions: [{ date: '2025-11-01', description: 'x', charges: 0, credits: 1, balance: 1 }],
      },
    ],
  };

  it('queries the most recent batch (orderBy createdAt desc) on the no-batchId path', async () => {
    // A batch with no retained storage — confirm throws IMPORT_BATCH_NO_STORAGE
    // right after the lookup, which is all we need to assert the ordering.
    const findFirst = jest.fn().mockResolvedValue({
      id: 'batch-stale',
      condominiumId: CONDOMINIUM_ID,
      status: 'PENDING',
      storageKey: null,
      storageProvider: null,
      _count: { transactions: 0 },
    });
    const service = makeConfirmService(findFirst);

    await expect(
      service.confirm(CONDOMINIUM_ID, confirmDto as never, { sub: 'user-1' } as never),
    ).rejects.toThrow();

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { condominiumId: CONDOMINIUM_ID, fileHash: HASH_A },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

describe('ImportsService.findAll filters', () => {
  it('applies importedByName as case-insensitive contains on firstName or lastName', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.importBatch.findMany.mockResolvedValueOnce([]);
    prisma.importBatch.count!.mockResolvedValueOnce(0);

    await service.findAll(CONDOMINIUM_ID, {
      page: 1,
      limit: 15,
      importedByName: 'mario',
    } as never);

    const call = prisma.importBatch.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      condominiumId: CONDOMINIUM_ID,
      importedBy: {
        OR: [
          { firstName: { contains: 'mario', mode: 'insensitive' } },
          { lastName: { contains: 'mario', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('applies importedByName full-name search with AND on firstName + lastName', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.importBatch.findMany.mockResolvedValueOnce([]);
    prisma.importBatch.count!.mockResolvedValueOnce(0);

    await service.findAll(CONDOMINIUM_ID, {
      page: 1,
      limit: 15,
      importedByName: 'carlos mendoza',
    } as never);

    const call = prisma.importBatch.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      condominiumId: CONDOMINIUM_ID,
      importedBy: {
        OR: expect.arrayContaining([
          { firstName: { contains: 'carlos mendoza', mode: 'insensitive' } },
          { lastName: { contains: 'carlos mendoza', mode: 'insensitive' } },
          {
            AND: [
              { firstName: { contains: 'carlos', mode: 'insensitive' } },
              { lastName: { contains: 'mendoza', mode: 'insensitive' } },
            ],
          },
        ]),
      },
    });
  });

  it('omits the importedBy clause when importedByName is not provided', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.importBatch.findMany.mockResolvedValueOnce([]);
    prisma.importBatch.count!.mockResolvedValueOnce(0);

    await service.findAll(CONDOMINIUM_ID, { page: 1, limit: 15 } as never);

    const call = prisma.importBatch.findMany.mock.calls[0][0];
    expect(call.where.importedBy).toBeUndefined();
  });
});
