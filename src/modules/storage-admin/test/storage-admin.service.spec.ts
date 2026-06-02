import { StorageAdminService, EnrichedObject } from '../storage-admin.service';

interface PrismaMock {
  condominium: { findMany: jest.Mock };
  importBatch: { findMany: jest.Mock };
  user: { findMany: jest.Mock };
  r2AccessLog: { groupBy: jest.Mock; findMany: jest.Mock };
}

function makePrisma(overrides?: {
  users?: Array<{ id: string; firstName: string; lastName: string; email: string }>;
  condominiums?: Array<{ id: string; slug: string; name: string }>;
  batches?: unknown[];
}): PrismaMock {
  return {
    condominium: {
      findMany: jest.fn(() => Promise.resolve(overrides?.condominiums ?? [])),
    },
    importBatch: {
      findMany: jest.fn(() => Promise.resolve(overrides?.batches ?? [])),
    },
    user: {
      findMany: jest.fn(() => Promise.resolve(overrides?.users ?? [])),
    },
    r2AccessLog: {
      groupBy: jest.fn(() => Promise.resolve([])),
      findMany: jest.fn(() => Promise.resolve([])),
    },
  };
}

const storageStub = {
  isConfigured: () => true,
  getClient: () => ({ send: jest.fn() }),
  getBucketName: () => 'test-bucket',
};

/** Build a service whose R2 listing is pre-seeded (bypasses S3). */
function makeService(
  prisma: PrismaMock,
  rawObjects: Array<{ key: string; size: number }>,
): StorageAdminService {
  const service = new StorageAdminService(prisma as never, storageStub as never);
  // Seed the private list cache so loadRawObjects() returns our fixture.
  (service as unknown as { listCache: unknown }).listCache = {
    fetchedAt: Date.now(),
    objects: rawObjects.map((o) => ({
      key: o.key,
      size: o.size,
      lastModified: new Date('2026-06-01T22:37:00.000Z'),
      etag: '"abc"',
    })),
  };
  return service;
}

function loadEnriched(service: StorageAdminService): Promise<EnrichedObject[]> {
  return (
    service as unknown as {
      loadEnrichedObjects: () => Promise<EnrichedObject[]>;
    }
  ).loadEnrichedObjects();
}

const AVATAR_KEY =
  'condominiums/759debca-b53c-49ed-a137-ca7cd7f202f6/users/user-050/avatar-1780375016527.jpg';

describe('StorageAdminService.loadEnrichedObjects — avatar uploader resolution', () => {
  it('resolves the uploader from the user id embedded in a tenant-scoped avatar key', async () => {
    const prisma = makePrisma({
      condominiums: [
        { id: '759debca-b53c-49ed-a137-ca7cd7f202f6', slug: 'coto', name: 'Coto La Alameda 1511' },
      ],
      users: [
        { id: 'user-050', firstName: 'Admin', lastName: 'Root', email: 'root@example.com' },
      ],
    });
    const service = makeService(prisma, [{ key: AVATAR_KEY, size: 53_000 }]);

    const [obj] = await loadEnriched(service);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-050'] } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    expect(obj.uploader).toEqual({
      id: 'user-050',
      firstName: 'Admin',
      lastName: 'Root',
      email: 'root@example.com',
    });
    expect(obj.isOrphan).toBe(false);
    expect(obj.condominium?.name).toBe('Coto La Alameda 1511');
  });

  it('resolves the uploader for a platform-scoped avatar key', async () => {
    const prisma = makePrisma({
      users: [
        { id: 'user-099', firstName: 'Plat', lastName: 'Admin', email: 'plat@example.com' },
      ],
    });
    const service = makeService(prisma, [
      { key: 'platform/users/user-099/avatar-1.jpg', size: 1_000 },
    ]);

    const [obj] = await loadEnriched(service);

    expect(obj.uploader?.id).toBe('user-099');
    expect(obj.condominium).toBeNull();
    expect(obj.isOrphan).toBe(false);
  });

  it('marks a user-scoped file as orphan and leaves uploader null when the user no longer exists', async () => {
    const prisma = makePrisma({ users: [] }); // user lookup returns nothing
    const service = makeService(prisma, [{ key: AVATAR_KEY, size: 53_000 }]);

    const [obj] = await loadEnriched(service);

    expect(obj.uploader).toBeNull();
    expect(obj.isOrphan).toBe(true);
  });

  it('still resolves the uploader from the import batch for import files (regression guard)', async () => {
    const prisma = makePrisma({
      condominiums: [{ id: 'cond-1', slug: 'c1', name: 'Cond One' }],
      batches: [
        {
          id: 'batch-1',
          status: 'COMPLETED',
          fileName: 'statement.xlsx',
          createdAt: new Date('2026-05-01T10:00:00.000Z'),
          transactionCount: 12,
          importedById: 'importer-1',
          importedBy: {
            id: 'importer-1',
            firstName: 'Imp',
            lastName: 'Orter',
            email: 'imp@example.com',
          },
        },
      ],
    });
    const service = makeService(prisma, [
      { key: 'condominiums/cond-1/imports/batch-1/statement.xlsx', size: 2_000 },
    ]);

    const [obj] = await loadEnriched(service);

    expect(obj.uploader?.id).toBe('importer-1');
    expect(obj.isOrphan).toBe(false);
    expect(obj.recordCount).toBe(12);
  });
});
