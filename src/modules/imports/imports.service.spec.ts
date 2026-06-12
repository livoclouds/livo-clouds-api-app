import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { ImportsService } from './imports.service';
import { ImportProfileMismatchError } from './parser';
import {
  IMPORT_DUPLICATE_EVENT,
  IMPORT_FAILED_EVENT,
} from './events/import-notification-events';

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

describe('ImportsService.confirm — bank-profile guard', () => {
  function makeGuardService(bankProfileFindFirst: jest.Mock): ImportsService {
    const prisma = {
      importBatch: { findFirst: jest.fn() },
      bankProfile: { findFirst: bankProfileFindFirst },
    };
    const settings = {
      validateFeesConfigured: jest.fn().mockResolvedValue({ valid: true }),
    };
    return new ImportsService(
      prisma as never,
      {} as never,
      {} as never,
      settings as never,
      { log: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  const dtoWithProfile = {
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
    bankProfileId: 'bp-1',
  };

  it('rejects when the selected profile has no bank assigned', async () => {
    const service = makeGuardService(
      jest.fn().mockResolvedValue({ id: 'bp-1', bankName: null }),
    );
    await expect(
      service.confirm(CONDOMINIUM_ID, dtoWithProfile as never, { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ response: { code: 'BANK_PROFILE_MISSING_BANK' } });
  });

  it('rejects when the selected profile does not exist', async () => {
    const service = makeGuardService(jest.fn().mockResolvedValue(null));
    await expect(
      service.confirm(CONDOMINIUM_ID, dtoWithProfile as never, { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ response: { code: 'BANK_PROFILE_NOT_FOUND' } });
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

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE-032 — confirm lifecycle/race/failure coverage.
//
// makeFullDeps()/makeFullService() extend the existing makeService() convention
// additively: every collaborator is a jest.fn() stub wired with safe defaults so
// each test only overrides the behavior under scrutiny. The prisma mock's
// $transaction invokes its callback with the shared `tx` mock (exposed on the
// deps object) so tests can assert on the conditional updateMany / createMany.
// ─────────────────────────────────────────────────────────────────────────────

function makeFullDeps() {
  const tx = {
    importBatch: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    transaction: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return {
    tx,
    prisma: {
      // Supports both forms: callback (confirm's interactive tx) and array
      // (remove's batched deleteMany + updateMany).
      $transaction: jest.fn(async (arg: unknown) =>
        Array.isArray(arg)
          ? Promise.all(arg)
          : (arg as (t: typeof tx) => unknown)(tx),
      ),
      importBatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn(),
      },
      transaction: {
        groupBy: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      condominiumSettings: {
        findUnique: jest.fn().mockResolvedValue({ currency: 'MXN' }),
      },
      bankProfile: {
        findFirst: jest.fn(),
      },
    },
    storage: {
      isConfigured: jest.fn().mockReturnValue(true),
      uploadFile: jest.fn().mockResolvedValue(undefined),
      downloadFile: jest.fn(),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getPresignedUrl: jest.fn(),
    },
    classification: {
      classifyBatch: jest
        .fn()
        .mockResolvedValue({ total: 1, classified: 1, needsReview: 0, unmatched: 0 }),
      revertTerraceLinksForBatch: jest.fn().mockResolvedValue(undefined),
      recomputeSummariesForMonths: jest.fn().mockResolvedValue(undefined),
    },
    settings: {
      validateFeesConfigured: jest.fn().mockResolvedValue({ valid: true }),
    },
    audit: {
      log: jest.fn().mockResolvedValue(undefined),
    },
    parser: {
      parseBuffer: jest.fn(),
    },
    config: {
      get: jest.fn().mockReturnValue(true),
    },
    bankProfiles: {
      // ENGINE-005: confirm resolves the bank-profile fields exactly as
      // preview does. Default to the no-profile fallback shape.
      resolveFieldsForBatch: jest.fn().mockResolvedValue({
        profileId: null,
        profileName: null,
        fields: undefined,
      }),
    },
    events: {
      emit: jest.fn(),
    },
  };
}

function makeFullService(deps: ReturnType<typeof makeFullDeps>): ImportsService {
  return new ImportsService(
    deps.prisma as never,
    deps.storage as never,
    deps.classification as never,
    deps.settings as never,
    deps.audit as never,
    deps.parser as never,
    deps.config as never,
    deps.bankProfiles as never,
    deps.events as never,
  );
}

async function flushDeferred(): Promise<void> {
  // confirm() defers classification via setImmediate — flush the macrotask
  // queue twice so the async runner and its awaited mocks fully settle.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('ImportsService.confirm — lifecycle and races', () => {
  // The R2 object content must hash to the batch's stored fileHash or confirm
  // aborts with IMPORT_HASH_MISMATCH before reaching the paths under test.
  const R2_BUFFER = Buffer.from('canonical r2 content');
  const R2_HASH = crypto.createHash('sha256').update(R2_BUFFER).digest('hex');

  const clientRow = {
    date: '2025-11-01',
    description: 'PAGO UNIDAD 1',
    charges: 0,
    credits: 1500,
    balance: 1500,
  };
  const serverRow = { ...clientRow, flowType: 'income' as const };

  function makeConfirmDto() {
    return {
      files: [
        {
          fileName: 'movimientos.xlsx',
          fileType: 'xlsx',
          fileHash: R2_HASH,
          fileSizeBytes: 2048,
          warnings: [],
          transactions: [clientRow],
        },
      ],
    };
  }

  function makeExistingBatch(overrides: Record<string, unknown> = {}) {
    return {
      id: 'batch-1',
      condominiumId: CONDOMINIUM_ID,
      status: 'PENDING',
      fileType: 'xlsx',
      fileHash: R2_HASH,
      storageKey: `condominiums/${CONDOMINIUM_ID}/imports/batch-1/movimientos.xlsx`,
      storageProvider: 'r2',
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      _count: { transactions: 0 },
      ...overrides,
    };
  }

  function setupHappyPath(deps: ReturnType<typeof makeFullDeps>) {
    const existing = makeExistingBatch();
    deps.prisma.importBatch.findFirst.mockResolvedValue(existing);
    deps.storage.downloadFile.mockResolvedValue(R2_BUFFER);
    deps.parser.parseBuffer.mockResolvedValue({
      transactions: [serverRow],
      warnings: [],
    });
    deps.tx.importBatch.findUniqueOrThrow.mockResolvedValue({
      id: existing.id,
      condominiumId: CONDOMINIUM_ID,
      status: 'PROCESSING',
    });
    return existing;
  }

  it('flips the batch to PROCESSING via the conditional updateMany, chunk-inserts transactions, and returns a processing result', async () => {
    const deps = makeFullDeps();
    const existing = setupHappyPath(deps);
    const service = makeFullService(deps);

    const result = await service.confirm(
      CONDOMINIUM_ID,
      makeConfirmDto() as never,
      { sub: 'user-1' } as never,
    );
    await flushDeferred();

    expect(result.files[0]).toMatchObject({
      fileName: 'movimientos.xlsx',
      status: 'processing',
      batchId: existing.id,
      imported: 1,
      duplicateFile: false,
    });
    expect(result.pendingBatchIds).toEqual([existing.id]);
    expect(result.totalImported).toBe(1);

    expect(deps.tx.importBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: existing.id,
          updatedAt: existing.updatedAt,
          status: { not: 'COMPLETED' },
        },
        data: expect.objectContaining({
          status: 'PROCESSING',
          importedById: 'user-1',
          transactionCount: 1,
        }),
      }),
    );

    expect(deps.tx.transaction.createMany).toHaveBeenCalledTimes(1);
    const createManyArg = deps.tx.transaction.createMany.mock.calls[0][0];
    expect(createManyArg.data).toHaveLength(1);
    expect(createManyArg.data[0]).toMatchObject({
      condominiumId: CONDOMINIUM_ID,
      importBatchId: existing.id,
      credits: 1500,
      charges: null,
      flowType: 'INCOME',
      classificationStatus: 'NEEDS_REVIEW',
    });

    // The deferred runner picked the batch up after the HTTP-path resolved.
    expect(deps.classification.classifyBatch).toHaveBeenCalledWith(
      CONDOMINIUM_ID,
      existing.id,
      'user-1',
    );
  });

  it('throws ConflictException IMPORT_BATCH_RACE when the conditional updateMany matches zero rows', async () => {
    const deps = makeFullDeps();
    const existing = setupHappyPath(deps);
    deps.tx.importBatch.updateMany.mockResolvedValue({ count: 0 });
    const service = makeFullService(deps);

    await expect(
      service.confirm(CONDOMINIUM_ID, makeConfirmDto() as never, { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ response: { code: 'IMPORT_BATCH_RACE' } });

    // The optimistic lock must carry both preconditions.
    expect(deps.tx.importBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updatedAt: existing.updatedAt,
          status: { not: 'COMPLETED' },
        }),
      }),
    );
    expect(deps.tx.transaction.createMany).not.toHaveBeenCalled();
  });

  it('rejects an already-imported duplicate file without inserting transactions', async () => {
    const deps = makeFullDeps();
    const existing = makeExistingBatch({
      status: 'COMPLETED',
      _count: { transactions: 42 },
    });
    deps.prisma.importBatch.findFirst.mockResolvedValue(existing);
    const service = makeFullService(deps);

    // Single-file request where every file is a duplicate → escalated to 409.
    await expect(
      service.confirm(CONDOMINIUM_ID, makeConfirmDto() as never, { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_FILE' } });

    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
    expect(deps.tx.transaction.createMany).not.toHaveBeenCalled();
    expect(deps.events.emit).toHaveBeenCalledWith(
      IMPORT_DUPLICATE_EVENT,
      expect.objectContaining({
        condominiumId: CONDOMINIUM_ID,
        originalBatchId: existing.id,
        attemptedFileName: 'movimientos.xlsx',
      }),
    );
  });

  it('rejects with IMPORT_BATCH_NO_STORAGE when the batch has no retained R2 object', async () => {
    const deps = makeFullDeps();
    deps.prisma.importBatch.findFirst.mockResolvedValue(
      makeExistingBatch({ storageKey: null, storageProvider: null }),
    );
    const service = makeFullService(deps);

    await expect(
      service.confirm(CONDOMINIUM_ID, makeConfirmDto() as never, { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ response: { code: 'IMPORT_BATCH_NO_STORAGE' } });

    expect(deps.storage.downloadFile).not.toHaveBeenCalled();
    expect(deps.tx.transaction.createMany).not.toHaveBeenCalled();
    // The per-file catch audits the failure before rethrowing.
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPORT_FAILED',
        result: 'ERROR',
        afterState: expect.objectContaining({ errorCode: 'IMPORT_BATCH_NO_STORAGE' }),
      }),
    );
  });

  it('rejects with PAYLOAD_MISMATCH and writes an IMPORT_TAMPERING_DETECTED audit when client rows differ from the server re-parse', async () => {
    const deps = makeFullDeps();
    setupHappyPath(deps);
    // Server re-parse disagrees with the client preview on the amount.
    deps.parser.parseBuffer.mockResolvedValue({
      transactions: [{ ...serverRow, credits: 9999, balance: 9999 }],
      warnings: [],
    });
    const service = makeFullService(deps);

    await expect(
      service.confirm(CONDOMINIUM_ID, makeConfirmDto() as never, { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ response: { code: 'PAYLOAD_MISMATCH' } });

    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPORT_TAMPERING_DETECTED',
        result: 'WARNING',
        entityId: 'batch-1',
        afterState: expect.objectContaining({
          clientRowCount: 1,
          serverRowCount: 1,
          mismatchCount: 1,
        }),
      }),
    );
    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
    expect(deps.tx.transaction.createMany).not.toHaveBeenCalled();
  });
});

describe('ImportsService.upload — R2-strict rollback', () => {
  // Valid XLSX magic bytes (PK\x03\x04) so the upload reaches the R2 branch.
  const XLSX_BUFFER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function makeUploadFile() {
    return {
      buffer: XLSX_BUFFER,
      originalname: 'estado_cuenta.xlsx',
      mimetype: XLSX_MIME,
      size: XLSX_BUFFER.length,
    };
  }

  function setupUpload(deps: ReturnType<typeof makeFullDeps>, strictR2: boolean) {
    deps.config.get.mockImplementation((key: string) =>
      key === 'storage.strictR2Retention' ? strictR2 : undefined,
    );
    deps.prisma.importBatch.findMany.mockResolvedValue([]);
    deps.prisma.importBatch.create.mockResolvedValue({
      id: 'batch-orphan',
      condominiumId: CONDOMINIUM_ID,
      status: 'PENDING',
      fileHash: crypto.createHash('sha256').update(XLSX_BUFFER).digest('hex'),
      _count: { transactions: 0 },
    });
    deps.storage.uploadFile.mockRejectedValue(new Error('R2 unavailable'));
  }

  it('strict mode: deletes the orphan PENDING batch, returns STORAGE_UNAVAILABLE, audits IMPORT_FAILED with result ERROR', async () => {
    const deps = makeFullDeps();
    setupUpload(deps, true);
    const service = makeFullService(deps);

    const results = await service.upload(
      CONDOMINIUM_ID,
      [makeUploadFile()],
      { sub: 'user-1' } as never,
    );

    expect(results).toEqual([
      expect.objectContaining({
        fileName: 'estado_cuenta.xlsx',
        status: 'error',
        errorCode: 'STORAGE_UNAVAILABLE',
      }),
    ]);
    expect(deps.prisma.importBatch.delete).toHaveBeenCalledWith({
      where: { id: 'batch-orphan' },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPORT_FAILED',
        result: 'ERROR',
        entityId: 'batch-orphan',
        afterState: expect.objectContaining({
          errorCode: 'STORAGE_UNAVAILABLE',
          strictR2: true,
        }),
      }),
    );
  });

  it('strict mode: still returns the error result when the rollback delete itself rejects', async () => {
    const deps = makeFullDeps();
    setupUpload(deps, true);
    deps.prisma.importBatch.delete.mockRejectedValue(new Error('delete failed'));
    const service = makeFullService(deps);

    const results = await service.upload(
      CONDOMINIUM_ID,
      [makeUploadFile()],
      { sub: 'user-1' } as never,
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: 'error',
        errorCode: 'STORAGE_UNAVAILABLE',
      }),
    ]);
  });

  it('non-strict mode: keeps the batch and surfaces a retention warning instead', async () => {
    const deps = makeFullDeps();
    setupUpload(deps, false);
    const service = makeFullService(deps);

    const results = await service.upload(
      CONDOMINIUM_ID,
      [makeUploadFile()],
      { sub: 'user-1' } as never,
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: 'queued',
        batchId: 'batch-orphan',
        warnings: ['storage.retentionFailed'],
      }),
    ]);
    expect(deps.prisma.importBatch.delete).not.toHaveBeenCalled();
  });
});

describe('ImportsService.runClassificationAsync — failure handling', () => {
  const BATCH_ID = 'batch-async';

  function makePersistence(overrides: Record<string, unknown> = {}) {
    return {
      transactionCount: 3,
      invalidRowsSkipped: 0,
      warningCount: 0,
      totalIncome: 100,
      totalExpenses: 50,
      finalBalance: 50,
      reconciliationSummary: { clientRowCount: 3, serverRowCount: 3, mismatchCount: 0 },
      ...overrides,
    };
  }

  function run(
    service: ImportsService,
    persistence: ReturnType<typeof makePersistence>,
  ): Promise<void> {
    return (service as never as {
      runClassificationAsync: (
        condominiumId: string,
        batchId: string,
        fileName: string,
        userId: string,
        persistence: unknown,
      ) => Promise<void>;
    }).runClassificationAsync(
      CONDOMINIUM_ID,
      BATCH_ID,
      'movimientos.xlsx',
      'user-1',
      persistence,
    );
  }

  it('marks COMPLETED, persists the classification summary counters, and audits IMPORT_COMPLETED', async () => {
    const deps = makeFullDeps();
    deps.classification.classifyBatch.mockResolvedValue({
      total: 3,
      classified: 2,
      needsReview: 1,
      unmatched: 0,
    });
    const service = makeFullService(deps);

    await run(service, makePersistence());

    // ENGINE-058 — the COMPLETED update carries the classification summary.
    expect(deps.prisma.importBatch.update).toHaveBeenCalledWith({
      where: { id: BATCH_ID },
      data: expect.objectContaining({
        status: 'COMPLETED',
        completedAt: expect.any(Date),
        classifiedCount: 2,
        needsReviewCount: 1,
        unmatchedCount: 0,
        classifiedAt: expect.any(Date),
      }),
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPORT_COMPLETED',
        result: 'SUCCESS',
        entityId: BATCH_ID,
      }),
    );
  });

  it('marks FAILED with a "Classification failed:" errorMessage and audits IMPORT_FAILED with result WARNING when classifyBatch rejects', async () => {
    const deps = makeFullDeps();
    deps.classification.classifyBatch.mockRejectedValue(new Error('engine exploded'));
    const service = makeFullService(deps);

    await run(service, makePersistence());

    expect(deps.prisma.importBatch.update).toHaveBeenCalledWith({
      where: { id: BATCH_ID },
      data: {
        status: 'FAILED',
        errorMessage: 'Classification failed: engine exploded',
      },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPORT_FAILED',
        result: 'WARNING',
        entityId: BATCH_ID,
        afterState: expect.objectContaining({ errorCode: 'CLASSIFICATION_FAILED' }),
      }),
    );
    expect(deps.events.emit).toHaveBeenCalledWith(
      IMPORT_FAILED_EVENT,
      expect.objectContaining({ batchId: BATCH_ID, stage: 'CLASSIFY' }),
    );
  });

  it('never throws to the caller even when the FAILED update itself rejects', async () => {
    const deps = makeFullDeps();
    deps.classification.classifyBatch.mockRejectedValue(new Error('engine exploded'));
    deps.prisma.importBatch.update.mockRejectedValue(new Error('db down'));
    const service = makeFullService(deps);

    await expect(run(service, makePersistence())).resolves.toBeUndefined();

    // The IMPORT_FAILED audit is still attempted despite the update failure.
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'IMPORT_FAILED', result: 'WARNING' }),
    );
  });

  it('does not roll COMPLETED back when the notification emit fails', async () => {
    const deps = makeFullDeps();
    deps.events.emit.mockImplementation(() => {
      throw new Error('emitter down');
    });
    const service = makeFullService(deps);

    // warningCount > 0 routes to the IMPORT_WITH_WARNINGS emit, which throws.
    await expect(
      run(service, makePersistence({ warningCount: 2 })),
    ).resolves.toBeUndefined();

    expect(deps.prisma.importBatch.update).toHaveBeenCalledTimes(1);
    expect(deps.prisma.importBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Import pipeline integrity & recovery (ENGINE-002/005/017/026/028/
// 048/051). Reuses makeFullDeps()/makeFullService() from the ENGINE-032 block.
// ─────────────────────────────────────────────────────────────────────────────

describe('ImportsService.confirm — bank-profile field parity (ENGINE-005)', () => {
  const R2_BUFFER = Buffer.from('canonical r2 content');
  const R2_HASH = crypto.createHash('sha256').update(R2_BUFFER).digest('hex');
  const clientRow = {
    date: '2025-11-01',
    description: 'PAGO UNIDAD 1',
    charges: 0,
    credits: 1500,
    balance: 1500,
  };
  const serverRow = { ...clientRow, flowType: 'income' as const };
  const CUSTOM_FIELDS = [
    { key: 'date', label: 'Fecha', aliases: ['fecha operación'] },
  ];

  function makeDtoWithProfile() {
    return {
      bankProfileId: 'bp-1',
      files: [
        {
          fileName: 'movimientos.xlsx',
          fileType: 'xlsx',
          fileHash: R2_HASH,
          fileSizeBytes: 2048,
          warnings: [],
          transactions: [clientRow],
        },
      ],
    };
  }

  function setup(deps: ReturnType<typeof makeFullDeps>) {
    deps.prisma.bankProfile.findFirst.mockResolvedValue({
      id: 'bp-1',
      bankName: 'BanBajío',
    });
    deps.prisma.importBatch.findFirst.mockResolvedValue({
      id: 'batch-1',
      condominiumId: CONDOMINIUM_ID,
      status: 'PENDING',
      fileType: 'xlsx',
      fileHash: R2_HASH,
      storageKey: 'condominiums/cond-1/imports/batch-1/movimientos.xlsx',
      storageProvider: 'r2',
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      _count: { transactions: 0 },
    });
    deps.storage.downloadFile.mockResolvedValue(R2_BUFFER);
    deps.bankProfiles.resolveFieldsForBatch.mockResolvedValue({
      profileId: 'bp-1',
      profileName: 'Custom BanBajío',
      fields: CUSTOM_FIELDS,
    });
    deps.parser.parseBuffer.mockResolvedValue({
      transactions: [serverRow],
      warnings: [],
    });
    deps.tx.importBatch.findUniqueOrThrow.mockResolvedValue({
      id: 'batch-1',
      condominiumId: CONDOMINIUM_ID,
      status: 'PROCESSING',
    });
  }

  it('resolves fields via resolveFieldsForBatch with dto.bankProfileId and passes them to parseBuffer', async () => {
    const deps = makeFullDeps();
    setup(deps);
    const service = makeFullService(deps);

    const result = await service.confirm(
      CONDOMINIUM_ID,
      makeDtoWithProfile() as never,
      { sub: 'user-1' } as never,
    );

    expect(result.files[0]).toMatchObject({ status: 'processing' });
    expect(deps.bankProfiles.resolveFieldsForBatch).toHaveBeenCalledWith({
      condominiumId: CONDOMINIUM_ID,
      bankProfileId: 'bp-1',
      fileType: 'xlsx',
    });
    expect(deps.parser.parseBuffer).toHaveBeenCalledWith(
      R2_BUFFER,
      'xlsx',
      CUSTOM_FIELDS,
    );
  });

  it('maps ImportProfileMismatchError from the server re-parse to 400 PROFILE_MISMATCH (never a 500)', async () => {
    const deps = makeFullDeps();
    setup(deps);
    deps.parser.parseBuffer.mockRejectedValue(
      new ImportProfileMismatchError(
        [{ key: 'date', label: 'Fecha' }],
        ['Columna rara'],
      ),
    );
    const service = makeFullService(deps);

    await expect(
      service.confirm(CONDOMINIUM_ID, makeDtoWithProfile() as never, {
        sub: 'user-1',
      } as never),
    ).rejects.toMatchObject({
      response: {
        code: 'PROFILE_MISMATCH',
        bankProfileId: 'bp-1',
        profileName: 'Custom BanBajío',
      },
    });
    expect(deps.tx.transaction.createMany).not.toHaveBeenCalled();
  });
});

describe('ImportsService.confirm — order-resilient reconciliation (ENGINE-051)', () => {
  const R2_BUFFER = Buffer.from('canonical r2 content');
  const R2_HASH = crypto.createHash('sha256').update(R2_BUFFER).digest('hex');
  const rowA = {
    date: '2025-11-01',
    description: 'PAGO UNIDAD 1',
    charges: 0,
    credits: 1500,
    balance: 1500,
  };
  const rowB = {
    date: '2025-11-03',
    description: 'PAGO UNIDAD 2',
    charges: 0,
    credits: 800,
    balance: 2300,
  };

  function setup(
    deps: ReturnType<typeof makeFullDeps>,
    serverRows: Array<Record<string, unknown>>,
  ) {
    deps.prisma.importBatch.findFirst.mockResolvedValue({
      id: 'batch-1',
      condominiumId: CONDOMINIUM_ID,
      status: 'PENDING',
      fileType: 'xlsx',
      fileHash: R2_HASH,
      storageKey: 'condominiums/cond-1/imports/batch-1/movimientos.xlsx',
      storageProvider: 'r2',
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      _count: { transactions: 0 },
    });
    deps.storage.downloadFile.mockResolvedValue(R2_BUFFER);
    deps.parser.parseBuffer.mockResolvedValue({
      transactions: serverRows,
      warnings: [],
    });
    deps.tx.importBatch.findUniqueOrThrow.mockResolvedValue({
      id: 'batch-1',
      condominiumId: CONDOMINIUM_ID,
      status: 'PROCESSING',
    });
  }

  function dtoWithClientRows(rows: Array<Record<string, unknown>>) {
    return {
      files: [
        {
          fileName: 'movimientos.xlsx',
          fileType: 'xlsx',
          fileHash: R2_HASH,
          fileSizeBytes: 2048,
          warnings: [],
          transactions: rows,
        },
      ],
    };
  }

  it('accepts a confirm payload whose rows arrive in a different order than the server parse', async () => {
    const deps = makeFullDeps();
    // Server emits A then B; the client echoes B then A (e.g. a parser-version
    // emission-order change between preview and confirm).
    setup(deps, [
      { ...rowA, flowType: 'income' as const },
      { ...rowB, flowType: 'income' as const },
    ]);
    const service = makeFullService(deps);

    const result = await service.confirm(
      CONDOMINIUM_ID,
      dtoWithClientRows([rowB, rowA]) as never,
      { sub: 'user-1' } as never,
    );

    expect(result.files[0]).toMatchObject({ status: 'processing', imported: 2 });
  });

  it('still rejects a modified amount with PAYLOAD_MISMATCH after sorting', async () => {
    const deps = makeFullDeps();
    setup(deps, [
      { ...rowA, flowType: 'income' as const },
      { ...rowB, flowType: 'income' as const },
    ]);
    const service = makeFullService(deps);

    await expect(
      service.confirm(
        CONDOMINIUM_ID,
        dtoWithClientRows([rowB, { ...rowA, credits: 9999 }]) as never,
        { sub: 'user-1' } as never,
      ),
    ).rejects.toMatchObject({ response: { code: 'PAYLOAD_MISMATCH' } });
    expect(deps.tx.transaction.createMany).not.toHaveBeenCalled();
  });
});

describe('ImportsService.preview — row validation parity (ENGINE-026/028)', () => {
  // Valid XLSX magic bytes so preview reaches the parser branch.
  const XLSX_BUFFER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const XLSX_MIME =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function makePreviewFile() {
    return {
      buffer: XLSX_BUFFER,
      originalname: 'estado_cuenta.xlsx',
      mimetype: XLSX_MIME,
      size: XLSX_BUFFER.length,
    };
  }

  function setup(
    deps: ReturnType<typeof makeFullDeps>,
    rows: Array<Record<string, unknown>>,
  ) {
    deps.prisma.importBatch.findMany.mockResolvedValue([]);
    deps.bankProfiles.resolveFieldsForBatch.mockResolvedValue({
      profileId: null,
      profileName: null,
      fields: undefined,
    });
    deps.parser.parseBuffer.mockResolvedValue({
      transactions: rows,
      warnings: [],
    });
  }

  const validRow1 = {
    date: '2026-01-15',
    description: 'PAGO 1',
    charges: 0,
    credits: 100,
    balance: 100,
    flowType: 'income' as const,
  };
  const futureRow = {
    date: '2030-01-01',
    description: 'PAGO FUTURO',
    charges: 0,
    credits: 999,
    balance: 1099,
    flowType: 'income' as const,
  };
  const validRow2 = {
    date: '2026-01-20',
    description: 'PAGO 2',
    charges: 0,
    credits: 50,
    balance: 150,
    flowType: 'income' as const,
  };
  const validRow3 = {
    date: '2026-01-25',
    description: 'PAGO 3',
    charges: 0,
    credits: 25,
    balance: 175,
    flowType: 'income' as const,
  };

  it('excludes invalid rows from transactions, totals, transactionCount and finalBalance and reports them under validation', async () => {
    const deps = makeFullDeps();
    // 1 invalid of 4 rows = 25% — under the 30% abort threshold.
    setup(deps, [validRow1, futureRow, validRow2, validRow3]);
    const service = makeFullService(deps);

    const { results } = await service.preview(
      CONDOMINIUM_ID,
      [makePreviewFile()],
      [],
      ['client-1'],
    );

    expect(results[0]).toMatchObject({
      status: 'warning',
      transactionCount: 3,
      totalIncome: 175,
      totalExpenses: 0,
      // ENGINE-026 — chronologically latest VALID row (the future-dated row
      // is invalid and must not contribute its balance).
      finalBalance: 175,
      validation: {
        totalRows: 4,
        validRows: 3,
        invalidRows: 1,
      },
    });
    expect(results[0].transactions).toHaveLength(3);
    expect(results[0].validation?.sampleErrors).toEqual([
      expect.objectContaining({ rowIndex: 1, field: 'date' }),
    ]);
  });

  it('caps validation.sampleErrors at 20', async () => {
    const deps = makeFullDeps();
    const valid = Array.from({ length: 75 }, (_, i) => ({
      ...validRow1,
      description: `PAGO ${i}`,
    }));
    const invalid = Array.from({ length: 25 }, (_, i) => ({
      ...futureRow,
      description: `FUTURO ${i}`,
    }));
    setup(deps, [...valid, ...invalid]);
    const service = makeFullService(deps);

    const { results } = await service.preview(
      CONDOMINIUM_ID,
      [makePreviewFile()],
      [],
      ['client-1'],
    );

    expect(results[0].validation).toMatchObject({
      totalRows: 100,
      validRows: 75,
      invalidRows: 25,
    });
    expect(results[0].validation?.sampleErrors).toHaveLength(20);
  });

  it('returns status error when the invalid-row ratio exceeds 30%', async () => {
    const deps = makeFullDeps();
    setup(deps, [validRow1, futureRow, { ...futureRow, description: 'OTRO' }]);
    const service = makeFullService(deps);

    const { results } = await service.preview(
      CONDOMINIUM_ID,
      [makePreviewFile()],
      [],
      ['client-1'],
    );

    expect(results[0].status).toBe('error');
    expect(results[0].statusMessage).toContain('2 of 3 rows are invalid');
    expect(results[0].validation).toMatchObject({ invalidRows: 2 });
  });

  it('rejects parser-flagged amount rows with the precise reason — no double error (ENGINE-029/030)', async () => {
    const deps = makeFullDeps();
    setup(deps, [
      validRow1,
      {
        ...validRow1,
        description: 'EUROPEO',
        credits: NaN,
        parseIssues: [
          { field: 'credits', issue: 'ambiguousDecimal', raw: '1.234,56' },
        ],
      },
      {
        ...validRow2,
        description: 'BASURA',
        charges: NaN,
        parseIssues: [{ field: 'charges', issue: 'unparseable', raw: 'abc' }],
      },
      validRow3,
    ]);
    const service = makeFullService(deps);

    const { results } = await service.preview(
      CONDOMINIUM_ID,
      [makePreviewFile()],
      [],
      ['client-1'],
    );

    expect(results[0].validation).toMatchObject({ totalRows: 4, invalidRows: 2 });
    const errors = results[0].validation!.sampleErrors;
    expect(errors).toHaveLength(2); // exactly one error per flagged row
    expect(errors[0]).toMatchObject({ rowIndex: 1, field: 'credits' });
    expect(errors[0].message).toContain('Ambiguous decimal format');
    expect(errors[0].message).toContain("1.234,56");
    expect(errors[1]).toMatchObject({ rowIndex: 2, field: 'charges' });
    expect(errors[1].message).toContain('could not be parsed');
  });

  it('rejects both-sided rows (charge AND credit) so every surface counts them the same way (ENGINE-053)', async () => {
    const deps = makeFullDeps();
    setup(deps, [
      validRow1,
      {
        ...validRow1,
        description: 'AMBOS LADOS',
        charges: 200,
        credits: 300,
        flowType: 'income' as const,
      },
      validRow2,
      validRow3,
    ]);
    const service = makeFullService(deps);

    const { results } = await service.preview(
      CONDOMINIUM_ID,
      [makePreviewFile()],
      [],
      ['client-1'],
    );

    expect(results[0].validation).toMatchObject({ totalRows: 4, invalidRows: 1 });
    expect(results[0].validation?.sampleErrors).toEqual([
      expect.objectContaining({ rowIndex: 1, field: 'amounts' }),
    ]);
    // The rejected row contributes to NEITHER total.
    expect(results[0].totalIncome).toBe(175);
    expect(results[0].totalExpenses).toBe(0);
  });

  it('rejects rows whose balance is non-finite (would die at the Decimal cast otherwise)', async () => {
    const deps = makeFullDeps();
    setup(deps, [validRow1, { ...validRow2, balance: NaN }, validRow3]);
    const service = makeFullService(deps);

    const { results } = await service.preview(
      CONDOMINIUM_ID,
      [makePreviewFile()],
      [],
      ['client-1'],
    );

    expect(results[0].validation).toMatchObject({ totalRows: 3, invalidRows: 1 });
    expect(results[0].validation?.sampleErrors).toEqual([
      expect.objectContaining({ rowIndex: 1, field: 'balance' }),
    ]);
  });
});

describe('ImportsService.upload — concurrent duplicate (ENGINE-017)', () => {
  const XLSX_BUFFER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const XLSX_MIME =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function makeUploadFile() {
    return {
      buffer: XLSX_BUFFER,
      originalname: 'estado_cuenta.xlsx',
      mimetype: XLSX_MIME,
      size: XLSX_BUFFER.length,
    };
  }

  function p2002() {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
  }

  it('returns the existing live batch as queued when importBatch.create throws P2002', async () => {
    const deps = makeFullDeps();
    deps.prisma.importBatch.findMany.mockResolvedValue([]);
    deps.prisma.importBatch.create.mockRejectedValue(p2002());
    deps.prisma.importBatch.findFirst.mockResolvedValue({
      id: 'batch-winner',
      status: 'PENDING',
      _count: { transactions: 0 },
    });
    const service = makeFullService(deps);

    const results = await service.upload(
      CONDOMINIUM_ID,
      [makeUploadFile()],
      { sub: 'user-1' } as never,
    );

    expect(results).toEqual([
      expect.objectContaining({ status: 'queued', batchId: 'batch-winner' }),
    ]);
    expect(deps.prisma.importBatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'FAILED' } }),
      }),
    );
    // The loser never reaches the R2 branch with its own batch.
    expect(deps.storage.uploadFile).not.toHaveBeenCalled();
  });

  it('returns a duplicate result when the P2002 winner is COMPLETED with transactions', async () => {
    const deps = makeFullDeps();
    deps.prisma.importBatch.findMany.mockResolvedValue([]);
    deps.prisma.importBatch.create.mockRejectedValue(p2002());
    deps.prisma.importBatch.findFirst.mockResolvedValue({
      id: 'batch-winner',
      status: 'COMPLETED',
      _count: { transactions: 12 },
    });
    const service = makeFullService(deps);

    // Single-file all-duplicate request escalates to 409 (UF-017).
    await expect(
      service.upload(CONDOMINIUM_ID, [makeUploadFile()], {
        sub: 'user-1',
      } as never),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_FILE' } });
  });
});

describe('ImportsService.upload — R2 pointer-update compensation (ENGINE-048)', () => {
  const XLSX_BUFFER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const XLSX_MIME =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function makeUploadFile() {
    return {
      buffer: XLSX_BUFFER,
      originalname: 'estado_cuenta.xlsx',
      mimetype: XLSX_MIME,
      size: XLSX_BUFFER.length,
    };
  }

  function setup(deps: ReturnType<typeof makeFullDeps>) {
    deps.config.get.mockImplementation((key: string) =>
      key === 'storage.strictR2Retention' ? true : undefined,
    );
    deps.prisma.importBatch.findMany.mockResolvedValue([]);
    deps.prisma.importBatch.create.mockResolvedValue({
      id: 'batch-orphan',
      condominiumId: CONDOMINIUM_ID,
      status: 'PENDING',
      fileHash: crypto.createHash('sha256').update(XLSX_BUFFER).digest('hex'),
      _count: { transactions: 0 },
    });
    // PUT succeeds; the storageKey pointer update fails.
    deps.storage.uploadFile.mockResolvedValue(undefined);
    deps.prisma.importBatch.update.mockRejectedValue(new Error('db down'));
  }

  it('deletes the uploaded R2 object when the storageKey pointer update fails', async () => {
    const deps = makeFullDeps();
    setup(deps);
    const service = makeFullService(deps);

    const results = await service.upload(
      CONDOMINIUM_ID,
      [makeUploadFile()],
      { sub: 'user-1' } as never,
    );

    expect(deps.storage.deleteFile).toHaveBeenCalledWith(
      expect.stringContaining('imports/batch-orphan/'),
    );
    expect(results).toEqual([
      expect.objectContaining({
        status: 'error',
        errorCode: 'STORAGE_UNAVAILABLE',
      }),
    ]);
  });

  it('swallows a failed compensating delete and still surfaces STORAGE_UNAVAILABLE', async () => {
    const deps = makeFullDeps();
    setup(deps);
    deps.storage.deleteFile.mockRejectedValue(new Error('R2 also down'));
    const service = makeFullService(deps);

    const results = await service.upload(
      CONDOMINIUM_ID,
      [makeUploadFile()],
      { sub: 'user-1' } as never,
    );

    expect(results).toEqual([
      expect.objectContaining({
        status: 'error',
        errorCode: 'STORAGE_UNAVAILABLE',
      }),
    ]);
  });
});

describe('ImportsService.remove — hard delete (ENGINE-002)', () => {
  function makeBatchRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'batch-del',
      condominiumId: CONDOMINIUM_ID,
      status: 'COMPLETED',
      fileName: 'movimientos.xlsx',
      transactionCount: 12,
      totalIncome: 1000,
      totalExpenses: 200,
      finalBalance: 800,
      updatedAt: new Date(Date.now() - 60_000),
      transactions: [],
      importedBy: null,
      fileDeletedBy: null,
      ...overrides,
    };
  }

  it('deletes the batch transactions, flags the batch FAILED with zeroed counters, and recomputes affected monthly summaries', async () => {
    const deps = makeFullDeps();
    deps.prisma.importBatch.findFirst.mockResolvedValue(makeBatchRow());
    deps.prisma.transaction.groupBy.mockResolvedValue([
      { transactionDate: new Date('2026-03-05T00:00:00Z') },
      { transactionDate: new Date('2026-03-18T00:00:00Z') },
      { transactionDate: new Date('2026-04-10T00:00:00Z') },
    ]);
    deps.prisma.transaction.deleteMany.mockResolvedValue({ count: 12 });
    const service = makeFullService(deps);

    await service.remove(CONDOMINIUM_ID, 'batch-del', { sub: 'user-1' } as never);

    expect(deps.prisma.transaction.deleteMany).toHaveBeenCalledWith({
      where: { condominiumId: CONDOMINIUM_ID, importBatchId: 'batch-del' },
    });
    expect(deps.prisma.importBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-del', condominiumId: CONDOMINIUM_ID },
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Deleted by user',
          transactionCount: 0,
          totalIncome: 0,
          totalExpenses: 0,
          finalBalance: 0,
          classifiedCount: 0,
        }),
      }),
    );
    expect(deps.classification.recomputeSummariesForMonths).toHaveBeenCalledWith(
      CONDOMINIUM_ID,
      expect.arrayContaining([
        { year: 2026, month: 3 },
        { year: 2026, month: 4 },
      ]),
    );
    expect(
      deps.classification.recomputeSummariesForMonths.mock.calls[0][1],
    ).toHaveLength(2);
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPORT_DELETED',
        afterState: expect.objectContaining({ transactionsDeleted: 12 }),
      }),
    );
  });

  it('reverts terrace-event paid status for linked transactions before deleting', async () => {
    const deps = makeFullDeps();
    deps.prisma.importBatch.findFirst.mockResolvedValue(makeBatchRow());
    const service = makeFullService(deps);

    await service.remove(CONDOMINIUM_ID, 'batch-del', { sub: 'user-1' } as never);

    expect(deps.classification.revertTerraceLinksForBatch).toHaveBeenCalledWith(
      CONDOMINIUM_ID,
      'batch-del',
      'user-1',
    );
    // Revert must run before the rows disappear.
    const revertOrder =
      deps.classification.revertTerraceLinksForBatch.mock.invocationCallOrder[0];
    const deleteOrder =
      deps.prisma.transaction.deleteMany.mock.invocationCallOrder[0];
    expect(revertOrder).toBeLessThan(deleteOrder);
  });

  it('refuses a fresh PROCESSING batch with 409 IMPORT_BATCH_PROCESSING', async () => {
    const deps = makeFullDeps();
    deps.prisma.importBatch.findFirst.mockResolvedValue(
      makeBatchRow({ status: 'PROCESSING', updatedAt: new Date() }),
    );
    const service = makeFullService(deps);

    await expect(
      service.remove(CONDOMINIUM_ID, 'batch-del', { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ response: { code: 'IMPORT_BATCH_PROCESSING' } });
    expect(deps.prisma.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it('allows removing a PROCESSING batch stale beyond 30 minutes', async () => {
    const deps = makeFullDeps();
    deps.prisma.importBatch.findFirst.mockResolvedValue(
      makeBatchRow({
        status: 'PROCESSING',
        updatedAt: new Date(Date.now() - 31 * 60 * 1000),
      }),
    );
    const service = makeFullService(deps);

    await service.remove(CONDOMINIUM_ID, 'batch-del', { sub: 'user-1' } as never);

    expect(deps.prisma.transaction.deleteMany).toHaveBeenCalled();
  });
});
