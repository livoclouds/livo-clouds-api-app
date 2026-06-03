import { BankProfilesService } from './bank-profiles.service';

const CONDOMINIUM_ID = 'cond-1';
const PROFILE_ID = 'bp-1';
const USER = { sub: 'user-1' } as never;

interface PrismaMock {
  bankProfile: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    bankProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaMock) => Promise<unknown>)(mock);
    }
    return undefined;
  });
  return mock;
}

const EXISTING = {
  id: PROFILE_ID,
  condominiumId: CONDOMINIUM_ID,
  name: 'Default',
  bankName: 'BBVA',
  isDefault: true,
  isActive: true,
  useSameForPdf: true,
  excelAliases: [{ key: 'date', aliases: ['fecha'] }],
  pdfAliases: [],
};

describe('BankProfilesService.update — field-level audit trail', () => {
  it('records who/which/old->new when the bank changes', async () => {
    const prisma = makePrismaMock();
    prisma.bankProfile.findFirst.mockResolvedValue(EXISTING); // findOneOrFail
    prisma.bankProfile.update.mockResolvedValue({ ...EXISTING, bankName: 'BanBajío' });

    const service = new BankProfilesService(prisma as never);
    await service.update(CONDOMINIUM_ID, PROFILE_ID, { bankName: 'BanBajío' }, USER);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data.action).toBe('BANK_PROFILE_UPDATED');
    expect(data.entityId).toBe(PROFILE_ID); // which profile
    expect(data.userId).toBe('user-1'); // who

    // before/after snapshots carry the full old->new state per field…
    expect(data.beforeState.bankName).toBe('BBVA');
    expect(data.afterState.bankName).toBe('BanBajío');

    // …and the compact diff lists exactly the changed field with its values.
    const changes = JSON.parse(data.detail);
    expect(changes).toEqual([
      { field: 'bankName', oldValue: 'BBVA', newValue: 'BanBajío' },
    ]);
  });

  it('writes a null diff when nothing actually changed', async () => {
    const prisma = makePrismaMock();
    prisma.bankProfile.findFirst.mockResolvedValue(EXISTING);
    prisma.bankProfile.update.mockResolvedValue({ ...EXISTING });

    const service = new BankProfilesService(prisma as never);
    await service.update(CONDOMINIUM_ID, PROFILE_ID, { bankName: 'BBVA' }, USER);

    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data.detail).toBeNull();
  });
});
