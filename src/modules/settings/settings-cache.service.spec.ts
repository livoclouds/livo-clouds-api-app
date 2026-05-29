import { SettingsCacheService } from './settings-cache.service';

interface PrismaMock {
  condominiumSettings: { findUnique: jest.Mock };
}

function makePrisma(): PrismaMock {
  return {
    condominiumSettings: {
      findUnique: jest.fn((args: { where: { condominiumId: string } }) =>
        Promise.resolve({
          condominiumId: args.where.condominiumId,
          currency: 'MXN',
          terraceGlobalKeywords: [],
          condominium: { name: 'Demo', primaryColor: '#000', slug: 'demo' },
        }),
      ),
    },
  };
}

function makeService(prisma: PrismaMock): SettingsCacheService {
  return new SettingsCacheService(prisma as never);
}

describe('SettingsCacheService', () => {
  const ORIGINAL_TTL = process.env.SETTINGS_CACHE_TTL_MS;

  afterEach(() => {
    if (ORIGINAL_TTL === undefined) {
      delete process.env.SETTINGS_CACHE_TTL_MS;
    } else {
      process.env.SETTINGS_CACHE_TTL_MS = ORIGINAL_TTL;
    }
    jest.restoreAllMocks();
  });

  it('serves a second read from cache without hitting the DB again', async () => {
    process.env.SETTINGS_CACHE_TTL_MS = '60000';
    const prisma = makePrisma();
    const service = makeService(prisma);

    const first = await service.getSettings('cond-1');
    const second = await service.getSettings('cond-1');

    expect(first).toEqual(second);
    expect(prisma.condominiumSettings.findUnique).toHaveBeenCalledTimes(1);
  });

  it('reloads from the DB after invalidate', async () => {
    process.env.SETTINGS_CACHE_TTL_MS = '60000';
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.getSettings('cond-1');
    service.invalidate('cond-1');
    await service.getSettings('cond-1');

    expect(prisma.condominiumSettings.findUnique).toHaveBeenCalledTimes(2);
  });

  it('reloads from the DB once the TTL has expired', async () => {
    process.env.SETTINGS_CACHE_TTL_MS = '1000';
    const prisma = makePrisma();
    const service = makeService(prisma);

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(10_000);
    await service.getSettings('cond-1');
    // Within TTL — still cached.
    nowSpy.mockReturnValue(10_500);
    await service.getSettings('cond-1');
    expect(prisma.condominiumSettings.findUnique).toHaveBeenCalledTimes(1);

    // Past TTL — reload.
    nowSpy.mockReturnValue(11_500);
    await service.getSettings('cond-1');
    expect(prisma.condominiumSettings.findUnique).toHaveBeenCalledTimes(2);
  });

  it('keeps entries isolated per condominium (no cross-tenant leak)', async () => {
    process.env.SETTINGS_CACHE_TTL_MS = '60000';
    const prisma = makePrisma();
    const service = makeService(prisma);

    const a = await service.getSettings('cond-A');
    const b = await service.getSettings('cond-B');

    expect(a?.condominiumId).toBe('cond-A');
    expect(b?.condominiumId).toBe('cond-B');
    expect(prisma.condominiumSettings.findUnique).toHaveBeenCalledTimes(2);
    // Invalidating one tenant must not drop the other.
    service.invalidate('cond-A');
    await service.getSettings('cond-B');
    expect(prisma.condominiumSettings.findUnique).toHaveBeenCalledTimes(2);
  });

  it('bypasses the cache entirely when TTL <= 0 (kill switch)', async () => {
    process.env.SETTINGS_CACHE_TTL_MS = '0';
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.getSettings('cond-1');
    await service.getSettings('cond-1');

    expect(prisma.condominiumSettings.findUnique).toHaveBeenCalledTimes(2);
  });
});
