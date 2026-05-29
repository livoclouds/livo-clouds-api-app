import { SettingsService } from './settings.service';

/**
 * Phase 6 (A5): guarantees that every settings write invalidates the
 * tenant-scoped cache, so a stale value can never survive a successful update on
 * the instance that handled it.
 */
describe('SettingsService cache invalidation', () => {
  const CONDO = 'cond-1';

  function setup() {
    const prisma = {
      condominiumSettings: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      condominium: {
        update: jest.fn().mockResolvedValue({ name: 'X', primaryColor: '#000', slug: 'x' }),
      },
    };
    const storage = {};
    const cache = { getSettings: jest.fn(), invalidate: jest.fn() };
    const service = new SettingsService(
      prisma as never,
      storage as never,
      cache as never,
    );
    return { service, prisma, cache };
  }

  it('updateGeneral invalidates the cache', async () => {
    const { service, cache } = setup();
    await service.updateGeneral(CONDO, {} as never);
    expect(cache.invalidate).toHaveBeenCalledWith(CONDO);
  });

  it('updateFees invalidates the cache', async () => {
    const { service, cache } = setup();
    await service.updateFees(CONDO, {} as never);
    expect(cache.invalidate).toHaveBeenCalledWith(CONDO);
  });

  it('updateFinancial invalidates the cache', async () => {
    const { service, cache } = setup();
    await service.updateFinancial(CONDO, {});
    expect(cache.invalidate).toHaveBeenCalledWith(CONDO);
  });

  it('updateTerrace invalidates the cache', async () => {
    const { service, cache } = setup();
    await service.updateTerrace(CONDO, {} as never);
    expect(cache.invalidate).toHaveBeenCalledWith(CONDO);
  });

  it('updateProfile invalidates the cache (writes condominium row findOne returns)', async () => {
    const { service, cache } = setup();
    await service.updateProfile(CONDO, {} as never);
    expect(cache.invalidate).toHaveBeenCalledWith(CONDO);
  });
});
