import { WhatsAppConversation } from '@prisma/client';
import { WhatsAppIdentityCaptureService } from './whatsapp-identity-capture.service';

function makeConversation(
  overrides: Partial<WhatsAppConversation> = {},
): WhatsAppConversation {
  return {
    id: 'conv-1',
    condominiumId: 'condo-1',
    residentId: null,
    unregisteredContactId: 'contact-1',
    phoneNumber: '+528112345678',
    contactName: null,
    status: 'BOT_ACTIVE',
    isOutOfHoursQueue: false,
    lastInboundAt: null,
    lastOutboundAt: null,
    escalatedAt: null,
    takenOverByUserId: null,
    takenOverAt: null,
    resolvedAt: null,
    resolvedByUserId: null,
    consecutiveFaqMisses: 0,
    unreadCountForAdmin: 0,
    isSystemChannel: false,
    firstNotifiedAt: null,
    reNotifiedAt: null,
    beRightWithYouSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WhatsAppConversation;
}

function makeService(residentMatches: { id: string; firstName: string; lastName: string }[]) {
  const prisma = {
    whatsAppUnregisteredContact: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'contact-1',
        status: 'NEW',
        capturedUnitNumber: null,
        capturedName: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppConversation: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    resident: {
      findMany: jest.fn().mockResolvedValue(residentMatches),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const service = new WhatsAppIdentityCaptureService(
    prisma as never,
    audit as never,
  );
  return { service, prisma, audit };
}

describe('WhatsAppIdentityCaptureService.tryCaptureIdentity', () => {
  it('auto-links the conversation when exactly one resident matches', async () => {
    const { service, prisma, audit } = makeService([
      { id: 'resident-9', firstName: 'Juan', lastName: 'Pérez' },
    ]);

    const result = await service.tryCaptureIdentity({
      conversation: makeConversation(),
      inboundText: 'casa 47, Juan Pérez',
    });

    expect(result.matchedResidentId).toBe('resident-9');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WHATSAPP_UNREGISTERED_AUTO_LINKED' }),
    );
  });

  it('does not link when two residents match', async () => {
    const { service, prisma } = makeService([
      { id: 'resident-1', firstName: 'Juan', lastName: 'Pérez' },
      { id: 'resident-2', firstName: 'Juana', lastName: 'Pérez' },
    ]);

    const result = await service.tryCaptureIdentity({
      conversation: makeConversation(),
      inboundText: 'casa 47, Juan Pérez',
    });

    expect(result.matchedResidentId).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still persists captured data when no resident matches', async () => {
    const { service, prisma } = makeService([]);

    const result = await service.tryCaptureIdentity({
      conversation: makeConversation(),
      inboundText: 'casa 47, Juan Pérez',
    });

    expect(result.matchedResidentId).toBeNull();
    expect(prisma.whatsAppUnregisteredContact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ capturedUnitNumber: '47' }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips conversations already linked to a resident', async () => {
    const { service, prisma } = makeService([
      { id: 'resident-9', firstName: 'Juan', lastName: 'Pérez' },
    ]);

    const result = await service.tryCaptureIdentity({
      conversation: makeConversation({ residentId: 'resident-existing' }),
      inboundText: 'casa 47, Juan Pérez',
    });

    expect(result.matchedResidentId).toBeNull();
    expect(prisma.whatsAppUnregisteredContact.update).not.toHaveBeenCalled();
  });

  it('returns null when the message contains no unit number', async () => {
    const { service, prisma } = makeService([
      { id: 'resident-9', firstName: 'Juan', lastName: 'Pérez' },
    ]);

    const result = await service.tryCaptureIdentity({
      conversation: makeConversation(),
      inboundText: 'hola buenas tardes',
    });

    expect(result.matchedResidentId).toBeNull();
    expect(prisma.whatsAppUnregisteredContact.update).not.toHaveBeenCalled();
  });
});
