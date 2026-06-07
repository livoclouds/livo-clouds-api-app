import { BadRequestException } from '@nestjs/common';
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

  // Fase 4 — per-condominium score weights are auto-normalized; reject all-zero.
  const validWeights = {
    onTime: 22, collectionRate: 16, monthsCurrent: 14, delinquencyAge: 14,
    balance: 10, recurrence: 12, trend: 12,
  };

  it('updateGeneral accepts a positive weight set and upserts it', async () => {
    const { service, prisma } = setup();
    await service.updateGeneral(CONDO, { financialHealthWeights: validWeights } as never);
    expect(prisma.condominiumSettings.upsert).toHaveBeenCalled();
  });

  it('updateGeneral rejects an all-zero weight set (would divide by zero)', async () => {
    const { service, prisma } = setup();
    const zeros = Object.fromEntries(Object.keys(validWeights).map((k) => [k, 0]));
    await expect(
      service.updateGeneral(CONDO, { financialHealthWeights: zeros } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.condominiumSettings.upsert).not.toHaveBeenCalled();
  });

  // Capa 2D — the auto-purge toggle persists alongside the retention window.
  it('updateGeneral persists dossierRetentionDays + autopurgeEnabled', async () => {
    const { service, prisma } = setup();
    await service.updateGeneral(CONDO, {
      dossierRetentionDays: 365,
      autopurgeEnabled: true,
    } as never);
    expect(prisma.condominiumSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ dossierRetentionDays: 365, autopurgeEnabled: true }),
        update: expect.objectContaining({ dossierRetentionDays: 365, autopurgeEnabled: true }),
      }),
    );
  });
});
