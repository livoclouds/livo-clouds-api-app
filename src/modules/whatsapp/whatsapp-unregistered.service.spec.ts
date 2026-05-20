import { ConflictException, NotFoundException } from '@nestjs/common';
import { WhatsAppUnregisteredService } from './whatsapp-unregistered.service';

const USER = { sub: 'user-1' } as never;

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact-1',
    condominiumId: 'condo-1',
    phoneNumber: '+528112345678',
    capturedUnitNumber: '47',
    capturedName: 'Juan Pérez',
    conversationCount: 3,
    messageCount: 9,
    lastSeenAt: new Date(),
    status: 'NEW',
    registeredResidentId: null,
    notes: null,
    identityPromptSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('WhatsAppUnregisteredService.list', () => {
  it('scopes the query to the condominium and applies filters', async () => {
    const prisma = {
      whatsAppUnregisteredContact: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new WhatsAppUnregisteredService(prisma as never, { log: jest.fn() } as never);

    await service.list('condo-1', { status: 'NEW', minConversationCount: 3 });

    expect(prisma.whatsAppUnregisteredContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          condominiumId: 'condo-1',
          status: 'NEW',
          conversationCount: { gte: 3 },
        }),
      }),
    );
  });

  it('does not leak contacts from another condominium', async () => {
    const prisma = {
      whatsAppUnregisteredContact: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new WhatsAppUnregisteredService(prisma as never, { log: jest.fn() } as never);

    await service.list('condo-A', {});

    const callArg = prisma.whatsAppUnregisteredContact.findMany.mock.calls[0][0];
    expect(callArg.where.condominiumId).toBe('condo-A');
  });
});

describe('WhatsAppUnregisteredService.update', () => {
  it('rejects an illegal status transition from REGISTERED', async () => {
    const prisma = {
      whatsAppUnregisteredContact: {
        findFirst: jest.fn().mockResolvedValue(makeContact({ status: 'REGISTERED' })),
        update: jest.fn(),
      },
    };
    const service = new WhatsAppUnregisteredService(prisma as never, { log: jest.fn() } as never);

    await expect(
      service.update('condo-1', 'contact-1', { status: 'NEW' }, USER),
    ).rejects.toThrow(ConflictException);
    expect(prisma.whatsAppUnregisteredContact.update).not.toHaveBeenCalled();
  });

  it('applies an inline correction and audits it', async () => {
    const audit = { log: jest.fn() };
    const prisma = {
      whatsAppUnregisteredContact: {
        findFirst: jest.fn().mockResolvedValue(makeContact()),
        update: jest.fn().mockResolvedValue(makeContact({ capturedUnitNumber: '88' })),
      },
    };
    const service = new WhatsAppUnregisteredService(prisma as never, audit as never);

    await service.update('condo-1', 'contact-1', { capturedUnitNumber: '88' }, USER);

    expect(prisma.whatsAppUnregisteredContact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { capturedUnitNumber: '88' } }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_UNREGISTERED_UPDATED' }),
    );
  });

  it('throws NotFoundException for an unknown contact', async () => {
    const prisma = {
      whatsAppUnregisteredContact: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const service = new WhatsAppUnregisteredService(prisma as never, { log: jest.fn() } as never);

    await expect(
      service.update('condo-1', 'missing', { notes: 'x' }, USER),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('WhatsAppUnregisteredService.registerAsResident', () => {
  function makeTx(occupied: unknown = null) {
    return {
      whatsAppUnregisteredContact: {
        findFirst: jest.fn().mockResolvedValue(makeContact()),
        update: jest.fn().mockResolvedValue({}),
      },
      resident: {
        findFirst: jest.fn().mockResolvedValue(occupied),
        create: jest.fn().mockResolvedValue({
          id: 'resident-1',
          firstName: 'Juan',
          lastName: 'Pérez',
        }),
      },
      whatsAppConversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
  }

  const DTO = {
    unitNumber: '47',
    residentType: 'OWNER',
    firstName: 'Juan',
    lastName: 'Pérez',
  } as never;

  it('atomically creates a resident and re-links all conversations', async () => {
    const tx = makeTx();
    const audit = { log: jest.fn() };
    const prisma = { $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
    const service = new WhatsAppUnregisteredService(prisma as never, audit as never);

    const result = await service.registerAsResident('condo-1', 'contact-1', DTO, USER);

    expect(result.conversationsRelinked).toBe(3);
    expect(tx.resident.create).toHaveBeenCalled();
    expect(tx.whatsAppConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          residentId: 'resident-1',
          unregisteredContactId: null,
        }),
      }),
    );
    expect(tx.whatsAppUnregisteredContact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REGISTERED' }) }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_UNREGISTERED_PROMOTED' }),
    );
  });

  it('rejects registration when the unit is already occupied', async () => {
    const tx = makeTx({ id: 'existing-resident' });
    const prisma = { $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
    const service = new WhatsAppUnregisteredService(prisma as never, { log: jest.fn() } as never);

    await expect(
      service.registerAsResident('condo-1', 'contact-1', DTO, USER),
    ).rejects.toThrow(ConflictException);
    expect(tx.resident.create).not.toHaveBeenCalled();
  });
});

describe('WhatsAppUnregisteredService.ignore', () => {
  it('sets the contact status to IGNORED and audits it', async () => {
    const audit = { log: jest.fn() };
    const prisma = {
      whatsAppUnregisteredContact: {
        findFirst: jest.fn().mockResolvedValue(makeContact()),
        update: jest.fn().mockResolvedValue(makeContact({ status: 'IGNORED' })),
      },
    };
    const service = new WhatsAppUnregisteredService(prisma as never, audit as never);

    await service.ignore('condo-1', 'contact-1', USER);

    expect(prisma.whatsAppUnregisteredContact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'IGNORED' } }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_UNREGISTERED_IGNORED' }),
    );
  });

  it('refuses to ignore an already-registered contact', async () => {
    const prisma = {
      whatsAppUnregisteredContact: {
        findFirst: jest.fn().mockResolvedValue(makeContact({ status: 'REGISTERED' })),
        update: jest.fn(),
      },
    };
    const service = new WhatsAppUnregisteredService(prisma as never, { log: jest.fn() } as never);

    await expect(service.ignore('condo-1', 'contact-1', USER)).rejects.toThrow(
      ConflictException,
    );
  });
});
