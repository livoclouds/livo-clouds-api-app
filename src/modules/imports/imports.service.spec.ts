import * as crypto from 'crypto';
import { ImportsService } from './imports.service';
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
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      importBatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn(),
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
      getPresignedUrl: jest.fn(),
    },
    classification: {
      classifyBatch: jest
        .fn()
        .mockResolvedValue({ total: 1, classified: 1, needsReview: 0, unmatched: 0 }),
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
      resolveFieldsForBatch: jest.fn(),
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
