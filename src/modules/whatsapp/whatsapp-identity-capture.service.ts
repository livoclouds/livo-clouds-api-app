import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppConversation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseIdentity } from './utils/identity-parser';

export interface IdentityCaptureResult {
  matchedResidentId: string | null;
}

/**
 * Resident matching Pass 3: links an unregistered contact to an existing
 * resident using identity captured from a free-text WhatsApp reply.
 *
 * Lives in its own service so the bot pipeline can call it without creating a
 * circular dependency with WhatsAppService.
 */
@Injectable()
export class WhatsAppIdentityCaptureService {
  private readonly logger = new Logger(WhatsAppIdentityCaptureService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  /**
   * Parses an inbound message for unit + name, persists the captured fields on
   * the unregistered contact, then attempts an exact-one resident match. When a
   * single safe match is found the conversation is atomically re-linked to that
   * resident and the contact is marked REGISTERED.
   */
  async tryCaptureIdentity(args: {
    conversation: WhatsAppConversation;
    inboundText: string | null;
  }): Promise<IdentityCaptureResult> {
    const { conversation, inboundText } = args;

    if (!conversation.unregisteredContactId || conversation.residentId) {
      return { matchedResidentId: null };
    }

    const parsed = parseIdentity(inboundText ?? '');
    if (!parsed.capturedUnitNumber) {
      return { matchedResidentId: null };
    }

    const contact = await this.prisma.whatsAppUnregisteredContact.findUnique({
      where: { id: conversation.unregisteredContactId },
    });
    if (!contact || contact.status === 'REGISTERED') {
      return { matchedResidentId: null };
    }

    await this.prisma.whatsAppUnregisteredContact.update({
      where: { id: contact.id },
      data: {
        capturedUnitNumber: parsed.capturedUnitNumber,
        ...(parsed.capturedName ? { capturedName: parsed.capturedName } : {}),
      },
    });

    const effectiveName = parsed.capturedName ?? contact.capturedName;
    const matches = await this.findResidentMatches(
      conversation.condominiumId,
      parsed.capturedUnitNumber,
      effectiveName,
    );

    if (matches.length !== 1) {
      return { matchedResidentId: null };
    }

    const resident = matches[0];
    const fullName = `${resident.firstName} ${resident.lastName}`.trim();

    await this.prisma.$transaction([
      this.prisma.whatsAppConversation.updateMany({
        where: { unregisteredContactId: contact.id },
        data: {
          residentId: resident.id,
          unregisteredContactId: null,
          contactName: fullName,
        },
      }),
      this.prisma.whatsAppUnregisteredContact.update({
        where: { id: contact.id },
        data: { status: 'REGISTERED', registeredResidentId: resident.id },
      }),
    ]);

    await this.auditService.log({
      condominiumId: conversation.condominiumId,
      userId: 'system',
      action: 'WHATSAPP_UNREGISTERED_AUTO_LINKED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppUnregisteredContact',
      entityId: contact.id,
      beforeState: {
        contactId: contact.id,
        capturedUnitNumber: parsed.capturedUnitNumber,
        status: contact.status,
      },
      afterState: { residentId: resident.id, status: 'REGISTERED' },
      result: 'SUCCESS',
      description: 'Unregistered contact auto-linked to resident via identity capture',
    });

    this.logger.log(
      `[identity-capture] contact ${contact.id} auto-linked to resident ${resident.id}`,
    );

    return { matchedResidentId: resident.id };
  }

  private async findResidentMatches(
    condominiumId: string,
    unitNumber: string,
    name: string | null,
  ) {
    const nameTokens = (name ?? '')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    const firstToken = nameTokens[0];
    const lastToken = nameTokens[nameTokens.length - 1];

    return this.prisma.resident.findMany({
      where: {
        condominiumId,
        unitNumber: { equals: unitNumber, mode: 'insensitive' },
        deletedAt: null,
        ...(firstToken
          ? {
              OR: [
                { firstName: { contains: firstToken, mode: 'insensitive' } },
                { lastName: { contains: lastToken, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, firstName: true, lastName: true },
      take: 2,
    });
  }
}
