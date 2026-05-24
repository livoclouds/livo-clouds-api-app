import { ImportsService } from './imports.service';

const CONDOMINIUM_ID = 'cond-1';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

interface PrismaMock {
  importBatch: {
    findMany: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    importBatch: {
      findMany: jest.fn(),
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
      { fileHash: HASH_A, _count: { transactions: 350 } },
      { fileHash: HASH_B, _count: { transactions: 0 } },
    ]);

    const result = await service.checkHashesForCondominium(CONDOMINIUM_ID, [
      HASH_A,
      HASH_B,
      HASH_C,
    ]);

    expect(result).toEqual({ duplicateHashes: [HASH_A] });
    expect(prisma.importBatch.findMany).toHaveBeenCalledWith({
      where: {
        condominiumId: CONDOMINIUM_ID,
        fileHash: { in: [HASH_A, HASH_B, HASH_C] },
        status: 'COMPLETED',
      },
      select: { fileHash: true, _count: { select: { transactions: true } } },
    });
  });

  it('returns an empty list when the hashes argument is empty without hitting the DB', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    const result = await service.checkHashesForCondominium(CONDOMINIUM_ID, []);

    expect(result).toEqual({ duplicateHashes: [] });
    expect(prisma.importBatch.findMany).not.toHaveBeenCalled();
  });

  it('deduplicates hashes when the DB returns multiple rows for the same hash', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma);

    prisma.importBatch.findMany.mockResolvedValueOnce([
      { fileHash: HASH_A, _count: { transactions: 100 } },
      { fileHash: HASH_A, _count: { transactions: 50 } },
    ]);

    const result = await service.checkHashesForCondominium(CONDOMINIUM_ID, [HASH_A]);

    expect(result).toEqual({ duplicateHashes: [HASH_A] });
  });
});
