import {
  maskPhone,
  normalizeMexicanPhone,
} from '../../common/utils/phone-normalization.util';
import { WhatsAppService } from './whatsapp.service';

describe('normalizeMexicanPhone', () => {
  it('normalizes a bare 10-digit Mexican number to E.164', () => {
    const result = normalizeMexicanPhone('8112345678');
    expect(result.outcome).toBe('normalized');
    expect(result.value).toBe('+528112345678');
  });

  it('strips separators from a bare 10-digit number', () => {
    expect(normalizeMexicanPhone('(81) 1234-5678').value).toBe('+528112345678');
    expect(normalizeMexicanPhone('81 1234 5678').value).toBe('+528112345678');
  });

  it('recognizes an already valid +52 E.164 number', () => {
    const result = normalizeMexicanPhone('+528112345678');
    expect(result.outcome).toBe('alreadyValid');
    expect(result.value).toBe('+528112345678');
  });

  it('drops the legacy mobile 1 from +521 numbers', () => {
    const result = normalizeMexicanPhone('+5218112345678');
    expect(result.outcome).toBe('normalized');
    expect(result.value).toBe('+528112345678');
  });

  it('skips non-Mexican E.164 numbers without mutating them', () => {
    const result = normalizeMexicanPhone('+14155552671');
    expect(result.outcome).toBe('skipped');
    expect(result.value).toBeNull();
  });

  it('marks empty or malformed input as invalid', () => {
    expect(normalizeMexicanPhone('').outcome).toBe('invalid');
    expect(normalizeMexicanPhone('12345').outcome).toBe('invalid');
    expect(normalizeMexicanPhone(null).outcome).toBe('invalid');
  });

  it('masks a phone number to the last four digits', () => {
    expect(maskPhone('+528112345678')).toBe('••••5678');
    expect(maskPhone('')).toBe('');
  });
});

// ─── normalizeResidentPhones endpoint ─────────────────────────────────────────

function makeService(residents: unknown[]) {
  const prisma = {
    resident: {
      findMany: jest.fn().mockResolvedValue(residents),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const auditService = { log: jest.fn().mockResolvedValue({}) };
  const service = new WhatsAppService(
    prisma as never,
    { get: jest.fn() } as never,
    auditService as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, auditService };
}

const RESIDENTS = [
  { id: 'r1', unitNumber: 'A-1', phone: '8112345678', secondaryPhone: null },
  { id: 'r2', unitNumber: 'A-2', phone: '+528119999999', secondaryPhone: '8110000000' },
  { id: 'r3', unitNumber: 'A-3', phone: '+14155552671', secondaryPhone: '12345' },
];

describe('WhatsAppService.normalizeResidentPhones', () => {
  it('dry-run classifies safe, skipped, and invalid numbers without writing', async () => {
    const { service, prisma, auditService } = makeService(RESIDENTS);

    const result = await service.normalizeResidentPhones(
      'condo-1',
      { apply: false },
      { sub: 'user-1' } as never,
    );

    expect(result.applied).toBe(false);
    expect(result.totalResidentsChecked).toBe(3);
    expect(result.normalizedCount).toBe(2); // r1.phone, r2.secondaryPhone
    expect(result.alreadyValidCount).toBe(1); // r2.phone
    expect(result.skippedCount).toBe(1); // r3.phone (non-Mexican)
    expect(result.invalidCount).toBe(1); // r3.secondaryPhone
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('apply persists only normalized numbers and writes one audit entry', async () => {
    const { service, prisma, auditService } = makeService(RESIDENTS);

    const result = await service.normalizeResidentPhones(
      'condo-1',
      { apply: true },
      { sub: 'user-1' } as never,
    );

    expect(result.applied).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.resident.updateMany).toHaveBeenCalledTimes(2);
    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_RESIDENT_PHONES_NORMALIZED' }),
    );
  });

  it('scopes every query and update to the current condominium', async () => {
    const { service, prisma } = makeService(RESIDENTS);

    await service.normalizeResidentPhones(
      'condo-1',
      { apply: true },
      { sub: 'user-1' } as never,
    );

    expect(prisma.resident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { condominiumId: 'condo-1', deletedAt: null },
      }),
    );
    for (const call of prisma.resident.updateMany.mock.calls) {
      expect(call[0].where).toEqual(
        expect.objectContaining({ condominiumId: 'condo-1' }),
      );
    }
  });
});
