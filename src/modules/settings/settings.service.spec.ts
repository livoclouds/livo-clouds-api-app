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

/**
 * CAL-053: GET /settings no longer leaks terrace pricing to members who lack
 * settings.read/update. The endpoint stays accessible (general/branding/fee fields
 * load for everyone), but the terrace amounts are nulled for non-privileged roles —
 * closing the bypass of the calendar module's own redactTerraceFinancials.
 */
describe('SettingsService.findOne terrace-pricing redaction', () => {
  const CONDO = 'cond-1';

  function setup() {
    const cache = {
      getSettings: jest.fn().mockResolvedValue({
        logoUrl: null,
        ordinaryFeeAmount: '1200.00',
        terraceRentalAmount: '1500.00',
        terraceSecurityDepositAmount: '1000.00',
        condominium: { name: 'Coto Alameda', primaryColor: '#123456', slug: 'coto' },
      }),
      invalidate: jest.fn(),
    };
    const storage = { getPresignedUrl: jest.fn() };
    const service = new SettingsService({} as never, storage as never, cache as never);
    return { service };
  }

  it('returns terrace amounts when the caller holds settings.read', async () => {
    const { service } = setup();
    const res = await service.findOne(CONDO, new Set(['settings.read']));
    expect(res.terraceRentalAmount).toBe('1500.00');
    expect(res.terraceSecurityDepositAmount).toBe('1000.00');
  });

  it('returns terrace amounts when the caller holds settings.update', async () => {
    const { service } = setup();
    const res = await service.findOne(CONDO, new Set(['settings.update']));
    expect(res.terraceRentalAmount).toBe('1500.00');
    expect(res.terraceSecurityDepositAmount).toBe('1000.00');
  });

  it('redacts terrace amounts for a RESIDENT-like set (calendar.read only)', async () => {
    const { service } = setup();
    const res = await service.findOne(CONDO, new Set(['calendar.read', 'notifications.read']));
    expect(res.terraceRentalAmount).toBeNull();
    expect(res.terraceSecurityDepositAmount).toBeNull();
    // Non-financial + fee fields stay intact — residents still see their dues + branding.
    expect(res.ordinaryFeeAmount).toBe('1200.00');
    expect(res.name).toBe('Coto Alameda');
    expect(res.primaryColor).toBe('#123456');
  });

  it('fails closed: redacts when no permission set is provided', async () => {
    const { service } = setup();
    const res = await service.findOne(CONDO);
    expect(res.terraceRentalAmount).toBeNull();
    expect(res.terraceSecurityDepositAmount).toBeNull();
  });
});
