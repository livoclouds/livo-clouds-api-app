import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PreconditionFailedException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../../common/types';
import { decrypt, encrypt, verifyHmacSha256 } from '../../common/utils/encryption.util';
import { WhatsAppMetaClientService } from './whatsapp-meta-client.service';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';
import { UpdateBotConfigDto } from './dto/update-bot-config.dto';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import { ListFaqsDto } from './dto/list-faqs.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ReorderFaqsDto } from './dto/reorder-faqs.dto';
import { ValidateNumberDto } from './dto/validate-number.dto';
import { NormalizeResidentPhonesDto } from './dto/normalize-resident-phones.dto';
import {
  maskPhone,
  normalizeMexicanPhone,
  type PhoneNormalizationOutcome,
} from '../../common/utils/phone-normalization.util';

const RESIDENT_PHONE_FIELDS = ['phone', 'secondaryPhone'] as const;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

interface MediaMetaFields {
  mediaMetaId: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaCaption: string | null;
  mediaSizeBytes: number | null;
}

const EMPTY_MEDIA_META: MediaMetaFields = {
  mediaMetaId: null,
  mediaMimeType: null,
  mediaFilename: null,
  mediaCaption: null,
  mediaSizeBytes: null,
};

/**
 * Extracts media references from a Meta inbound webhook message. Only the
 * reference ID and lightweight metadata are kept — bytes are never downloaded
 * here (they are fetched lazily through the media proxy when an admin views).
 */
export function extractMediaMeta(
  msg: Record<string, unknown>,
  msgType: string,
): MediaMetaFields {
  const node = msg[msgType] as Record<string, unknown> | undefined;
  if (!node || typeof node !== 'object') return { ...EMPTY_MEDIA_META };

  const mediaMetaId = typeof node.id === 'string' ? node.id : null;
  if (!mediaMetaId) return { ...EMPTY_MEDIA_META };

  return {
    mediaMetaId,
    mediaMimeType: typeof node.mime_type === 'string' ? node.mime_type : null,
    mediaFilename: typeof node.filename === 'string' ? node.filename : null,
    mediaCaption: typeof node.caption === 'string' ? node.caption : null,
    mediaSizeBytes:
      typeof node.file_size === 'number' ? node.file_size : null,
  };
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private auditService: AuditService,
    private metaClient: WhatsAppMetaClientService,
    private botService: WhatsAppBotService,
  ) {}

  // ── Credentials ─────────────────────────────────────────────────────────────

  async upsertCredential(condominiumId: string, dto: UpsertCredentialDto, user: JwtPayload) {
    const encryptionKey = this.configService.get<string>('whatsapp.encryptionKey', '');
    const { ciphertext, iv, authTag } = encrypt(dto.accessToken, encryptionKey);

    const existing = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId },
    });

    const webhookVerifyToken = existing?.webhookVerifyToken ?? randomBytes(32).toString('hex');
    const action = existing ? 'WHATSAPP_CREDENTIAL_UPDATED' : 'WHATSAPP_CREDENTIAL_CREATED';

    const credential = await this.prisma.whatsAppCredential.upsert({
      where: { condominiumId },
      create: {
        condominiumId,
        phoneNumberId: dto.phoneNumberId,
        phoneNumberDisplay: dto.phoneNumberDisplay,
        businessAccountId: dto.businessAccountId,
        accessTokenCiphertext: ciphertext,
        accessTokenIv: iv,
        accessTokenAuthTag: authTag,
        webhookVerifyToken,
      },
      update: {
        phoneNumberId: dto.phoneNumberId,
        phoneNumberDisplay: dto.phoneNumberDisplay,
        businessAccountId: dto.businessAccountId,
        accessTokenCiphertext: ciphertext,
        accessTokenIv: iv,
        accessTokenAuthTag: authTag,
        status: 'PENDING',
        verifiedAt: null,
      },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action,
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppCredential',
      entityId: credential.id,
      result: 'SUCCESS',
      description: `WhatsApp credential ${existing ? 'updated' : 'created'}`,
    });

    return this.sanitizeCredential(credential);
  }

  async getCredential(condominiumId: string) {
    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId },
    });
    if (!credential) return null;
    return this.sanitizeCredential(credential);
  }

  async deleteCredential(condominiumId: string, user: JwtPayload) {
    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId },
      select: { id: true },
    });
    if (!credential) throw new NotFoundException('Credential not found');

    await this.prisma.whatsAppCredential.update({
      where: { condominiumId },
      data: { status: 'REVOKED' },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_CREDENTIAL_DELETED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppCredential',
      entityId: credential.id,
      result: 'SUCCESS',
      description: 'WhatsApp credential revoked',
    });
  }

  /**
   * Validates whether a phone number is ready for WhatsApp Business / Cloud API
   * use. Meta can only inspect numbers registered in the condominium's own WABA,
   * so the lookup runs against the stored credential's `phoneNumberId`; the
   * submitted number is normalized for display and matching. The response is a
   * structured, UI-friendly result that never exposes tokens or raw Meta errors.
   */
  async validateNumber(condominiumId: string, dto: ValidateNumberDto) {
    const normalized = normalizeMexicanPhone(dto.phoneNumber);
    const normalizedPhoneNumber = normalized.value ?? dto.phoneNumber;

    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId },
    });
    if (!credential) {
      throw new PreconditionFailedException('credentialNotConfigured');
    }

    const encryptionKey = this.configService.get<string>('whatsapp.encryptionKey', '');
    const accessToken = decrypt(
      credential.accessTokenCiphertext,
      credential.accessTokenIv,
      credential.accessTokenAuthTag,
      encryptionKey,
    );

    const meta = await this.metaClient.validatePhoneNumber(
      credential.phoneNumberId,
      accessToken,
    );

    if (meta.failed) {
      await this.prisma.whatsAppCredential.update({
        where: { condominiumId },
        data: {
          lastApiErrorAt: new Date(),
          lastApiErrorMessage:
            meta.failureKind === 'network'
              ? 'validate-number: Meta API unreachable'
              : 'validate-number: Meta rejected the phone_number_id / token pair',
        },
      });

      if (meta.failureKind === 'network') {
        return {
          isWhatsAppBusiness: false,
          normalizedPhoneNumber,
          status: 'ERROR' as const,
          reason: 'metaUnavailable',
          recommendedNextStep: 'retryLater',
        };
      }
      return {
        isWhatsAppBusiness: false,
        normalizedPhoneNumber,
        status: 'NOT_BUSINESS' as const,
        reason: 'numberNotOnBusiness',
        recommendedNextStep: 'migrateToBusiness',
      };
    }

    const verified =
      !meta.codeVerificationStatus || meta.codeVerificationStatus === 'VERIFIED';
    if (!verified) {
      return {
        isWhatsAppBusiness: true,
        normalizedPhoneNumber,
        status: 'NOT_READY' as const,
        reason: 'numberNotVerified',
        recommendedNextStep: 'completeVerification',
      };
    }

    return {
      isWhatsAppBusiness: true,
      normalizedPhoneNumber,
      status: 'CONFIRMED' as const,
      reason: 'verified',
      recommendedNextStep: 'none',
    };
  }

  /**
   * Normalizes condominium resident phone numbers to E.164 (Mexican +52 rule).
   * Dry-run by default — `apply: true` persists only the safe `normalized`
   * outcomes inside a single transaction and writes one summary audit entry.
   * Admin notification phone numbers are intentionally untouched.
   */
  async normalizeResidentPhones(
    condominiumId: string,
    dto: NormalizeResidentPhonesDto,
    user: JwtPayload,
  ) {
    const apply = dto.apply ?? false;
    const residents = await this.prisma.resident.findMany({
      where: { condominiumId, deletedAt: null },
      select: { id: true, unitNumber: true, phone: true, secondaryPhone: true },
    });

    const counts: Record<PhoneNormalizationOutcome, number> = {
      normalized: 0,
      alreadyValid: 0,
      skipped: 0,
      invalid: 0,
    };
    const examples: {
      unitNumber: string;
      field: 'phone' | 'secondaryPhone';
      outcome: PhoneNormalizationOutcome;
      before: string;
      after: string | null;
    }[] = [];
    const pendingUpdates = new Map<string, Record<string, string>>();

    for (const resident of residents) {
      for (const field of RESIDENT_PHONE_FIELDS) {
        const current = resident[field];
        if (current == null || current.trim() === '') continue;

        const result = normalizeMexicanPhone(current);
        counts[result.outcome] += 1;

        if (result.outcome === 'normalized' && result.value) {
          const fields = pendingUpdates.get(resident.id) ?? {};
          fields[field] = result.value;
          pendingUpdates.set(resident.id, fields);
        }

        if (result.outcome !== 'alreadyValid' && examples.length < 25) {
          examples.push({
            unitNumber: resident.unitNumber,
            field,
            outcome: result.outcome,
            before: maskPhone(current),
            after: result.value ? maskPhone(result.value) : null,
          });
        }
      }
    }

    if (apply && pendingUpdates.size > 0) {
      await this.prisma.$transaction(
        [...pendingUpdates.entries()].map(([id, data]) =>
          this.prisma.resident.updateMany({
            where: { id, condominiumId },
            data,
          }),
        ),
      );

      await this.auditService.log({
        condominiumId,
        userId: user.sub,
        action: 'WHATSAPP_RESIDENT_PHONES_NORMALIZED',
        actionCategory: 'COMMUNICATIONS',
        module: 'WHATSAPP',
        entityType: 'Resident',
        result: 'SUCCESS',
        afterState: {
          normalizedCount: counts.normalized,
          affectedResidentIds: [...pendingUpdates.keys()],
        },
        description: `Normalized ${counts.normalized} resident phone number(s)`,
      });
    }

    return {
      applied: apply,
      totalResidentsChecked: residents.length,
      normalizedCount: counts.normalized,
      alreadyValidCount: counts.alreadyValid,
      skippedCount: counts.skipped,
      invalidCount: counts.invalid,
      examples,
    };
  }

  async getFaqUsageStats(condominiumId: string) {
    const faqs = await this.prisma.whatsAppFaq.findMany({
      where: { condominiumId },
      select: {
        id: true,
        triggers: true,
        category: true,
        usageCount: true,
        lastUsedAt: true,
        isActive: true,
      },
      orderBy: [{ usageCount: 'desc' }, { sortOrder: 'asc' }],
    });

    const totalMatches = faqs.reduce((sum, faq) => sum + faq.usageCount, 0);
    const lastUsedAt = faqs
      .map((faq) => faq.lastUsedAt)
      .filter((value): value is Date => value != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      totalFaqs: faqs.length,
      activeFaqs: faqs.filter((faq) => faq.isActive).length,
      totalMatches,
      lastUsedAt,
      topFaqs: faqs.filter((faq) => faq.usageCount > 0).slice(0, 5),
      unusedFaqs: faqs
        .filter((faq) => faq.usageCount === 0)
        .map(({ id, triggers, category, isActive }) => ({
          id,
          triggers,
          category,
          isActive,
        })),
    };
  }

  async testConnection(condominiumId: string) {
    const credential = await this.requireCredential(condominiumId);
    const encryptionKey = this.configService.get<string>('whatsapp.encryptionKey', '');
    const accessToken = decrypt(
      credential.accessTokenCiphertext,
      credential.accessTokenIv,
      credential.accessTokenAuthTag,
      encryptionKey,
    );
    return this.metaClient.testConnection(credential.phoneNumberId, accessToken);
  }

  // ── Bot Config ───────────────────────────────────────────────────────────────

  async getBotConfig(condominiumId: string) {
    return this.getOrCreateBotConfig(condominiumId);
  }

  async updateBotConfig(condominiumId: string, dto: UpdateBotConfigDto, user: JwtPayload) {
    await this.getOrCreateBotConfig(condominiumId);

    const config = await this.prisma.whatsAppBotConfig.update({
      where: { condominiumId },
      data: dto,
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_BOT_CONFIG_UPDATED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppBotConfig',
      entityId: config.id,
      result: 'SUCCESS',
      description: 'Bot configuration updated',
    });

    return config;
  }

  // ── FAQs ─────────────────────────────────────────────────────────────────────

  async listFaqs(condominiumId: string, query: ListFaqsDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = { condominiumId };
    if (query.category) where.category = query.category;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { answer: { contains: query.search, mode: 'insensitive' } },
        { triggers: { has: query.search } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.whatsAppFaq.count({ where }),
      this.prisma.whatsAppFaq.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: pageSize,
      }),
    ]);

    return { data: items, meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } };
  }

  async getFaq(condominiumId: string, faqId: string) {
    const faq = await this.prisma.whatsAppFaq.findFirst({
      where: { id: faqId, condominiumId },
    });
    if (!faq) throw new NotFoundException('FAQ not found');
    return faq;
  }

  async getFaqCategories(condominiumId: string): Promise<string[]> {
    const faqs = await this.prisma.whatsAppFaq.findMany({
      where: { condominiumId, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    });
    return faqs.map((f) => f.category as string).filter(Boolean);
  }

  async createFaq(condominiumId: string, dto: CreateFaqDto, user: JwtPayload) {
    const faq = await this.prisma.whatsAppFaq.create({
      data: {
        condominiumId,
        category: dto.category,
        triggers: dto.triggers,
        answer: dto.answer,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        createdByUserId: user.sub,
        updatedByUserId: user.sub,
      },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_FAQ_CREATED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppFaq',
      entityId: faq.id,
      result: 'SUCCESS',
      description: 'FAQ created',
    });

    return faq;
  }

  async updateFaq(condominiumId: string, faqId: string, dto: UpdateFaqDto, user: JwtPayload) {
    await this.getFaq(condominiumId, faqId);

    const faq = await this.prisma.whatsAppFaq.update({
      where: { id: faqId },
      data: { ...dto, updatedByUserId: user.sub },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_FAQ_UPDATED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppFaq',
      entityId: faq.id,
      result: 'SUCCESS',
      description: 'FAQ updated',
    });

    return faq;
  }

  async deleteFaq(condominiumId: string, faqId: string, user: JwtPayload) {
    await this.getFaq(condominiumId, faqId);

    await this.prisma.whatsAppFaq.delete({ where: { id: faqId } });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_FAQ_DELETED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppFaq',
      entityId: faqId,
      result: 'SUCCESS',
      description: 'FAQ deleted',
    });
  }

  async reorderFaqs(condominiumId: string, dto: ReorderFaqsDto) {
    await Promise.all(
      dto.orderedIds.map((id, index) =>
        this.prisma.whatsAppFaq.updateMany({
          where: { id, condominiumId },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  // ── Conversations ────────────────────────────────────────────────────────────

  async listConversations(condominiumId: string, query: ListConversationsDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = { condominiumId, isSystemChannel: false };
    if (query.status) where.status = query.status;
    if (query.unreadOnly) where.unreadCountForAdmin = { gt: 0 };
    if (query.phoneNumber) where.phoneNumber = { contains: query.phoneNumber };

    const [total, items] = await Promise.all([
      this.prisma.whatsAppConversation.count({ where }),
      this.prisma.whatsAppConversation.findMany({
        where,
        orderBy: [{ lastInboundAt: 'desc' }],
        skip,
        take: pageSize,
        include: {
          resident: { select: { id: true, firstName: true, lastName: true, unitNumber: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    return { data: items, meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } };
  }

  async getUnreadCount(condominiumId: string): Promise<{ total: number }> {
    const result = await this.prisma.whatsAppConversation.aggregate({
      where: {
        condominiumId,
        status: { not: WhatsAppConversationStatus.RESOLVED },
        isSystemChannel: false,
      },
      _sum: { unreadCountForAdmin: true },
    });
    return { total: result._sum.unreadCountForAdmin ?? 0 };
  }

  async getConversationDetail(condominiumId: string, conversationId: string) {
    const conv = await this.prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, condominiumId },
      include: {
        resident: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            unitNumber: true,
            email: true,
            phone: true,
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return conv;
  }

  async listMessages(condominiumId: string, conversationId: string) {
    await this.getConversationDetail(condominiumId, conversationId);
    return this.prisma.whatsAppMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sentBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async sendMessage(
    condominiumId: string,
    conversationId: string,
    dto: SendMessageDto,
    user: JwtPayload,
  ) {
    const conv = await this.getConversationDetail(condominiumId, conversationId);
    if (conv.status === WhatsAppConversationStatus.RESOLVED) {
      throw new BadRequestException('Cannot send message to resolved conversation');
    }

    const credential = await this.requireCredential(condominiumId);
    const encryptionKey = this.configService.get<string>('whatsapp.encryptionKey', '');
    const accessToken = decrypt(
      credential.accessTokenCiphertext,
      credential.accessTokenIv,
      credential.accessTokenAuthTag,
      encryptionKey,
    );

    let messageId: string;
    let messageType: WhatsAppMessageType = WhatsAppMessageType.TEXT;
    let mediaMetaId: string | null = null;
    let mediaMimeType: string | null = null;
    let mediaFilename: string | null = null;
    let mediaCaption: string | null = null;
    let mediaSizeBytes: number | null = null;

    if (dto.type === 'TEXT') {
      if (!dto.textContent) {
        throw new BadRequestException('textContent is required for text messages');
      }
      const result = await this.metaClient.sendTextMessage(
        credential.phoneNumberId,
        accessToken,
        conv.phoneNumber,
        dto.textContent,
      );
      messageId = result.messageId;
    } else {
      if (!dto.mediaBase64 || !dto.mediaMimeType) {
        throw new BadRequestException('Media payload is required for media messages');
      }
      if (dto.mediaMimeType === 'image/svg+xml') {
        throw new BadRequestException({
          code: 'WHATSAPP_MEDIA_UNSUPPORTED',
          message: 'SVG media is not supported',
        });
      }

      const buffer = Buffer.from(dto.mediaBase64, 'base64');
      if (buffer.length === 0) {
        throw new BadRequestException('Media payload is empty');
      }
      const maxBytes =
        dto.type === 'IMAGE' ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
      if (buffer.length > maxBytes) {
        throw new BadRequestException({
          code: 'WHATSAPP_MEDIA_TOO_LARGE',
          message: `Media exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit`,
        });
      }

      const filename = dto.mediaFilename ?? `attachment-${Date.now()}`;
      const { mediaId } = await this.metaClient.uploadMedia(
        credential.phoneNumberId,
        accessToken,
        buffer,
        dto.mediaMimeType,
        filename,
      );

      const sendResult =
        dto.type === 'IMAGE'
          ? await this.metaClient.sendImageMessage(
              credential.phoneNumberId,
              accessToken,
              conv.phoneNumber,
              mediaId,
              dto.mediaCaption,
            )
          : await this.metaClient.sendDocumentMessage(
              credential.phoneNumberId,
              accessToken,
              conv.phoneNumber,
              mediaId,
              filename,
              dto.mediaCaption,
            );

      messageId = sendResult.messageId;
      messageType =
        dto.type === 'IMAGE'
          ? WhatsAppMessageType.IMAGE
          : WhatsAppMessageType.DOCUMENT;
      mediaMetaId = mediaId;
      mediaMimeType = dto.mediaMimeType;
      mediaFilename = dto.type === 'DOCUMENT' ? filename : null;
      mediaCaption = dto.mediaCaption ?? null;
      mediaSizeBytes = buffer.length;
    }

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        conversationId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        messageType,
        textContent: null,
        mediaMetaId,
        mediaMimeType,
        mediaFilename,
        mediaCaption,
        mediaSizeBytes,
        sentByBot: false,
        sentByUserId: user.sub,
        metaMessageId: messageId || `admin-${Date.now()}`,
        status: WhatsAppMessageStatus.SENT,
      },
    });

    await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_MESSAGE_SENT',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppMessage',
      entityId: message.id,
      result: 'SUCCESS',
      description: `Admin sent WhatsApp ${dto.type.toLowerCase()} message`,
    });

    return message;
  }

  async takeOver(condominiumId: string, conversationId: string, user: JwtPayload) {
    const conv = await this.getConversationDetail(condominiumId, conversationId);

    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        status: WhatsAppConversationStatus.ADMIN_HANDLING,
        takenOverByUserId: user.sub,
        takenOverAt: new Date(),
      },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_CONVERSATION_TAKEN_OVER',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppConversation',
      entityId: conv.id,
      result: 'SUCCESS',
      description: 'Admin took over conversation',
    });

    return updated;
  }

  async returnToBot(condominiumId: string, conversationId: string, user: JwtPayload) {
    const conv = await this.getConversationDetail(condominiumId, conversationId);

    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        status: WhatsAppConversationStatus.BOT_ACTIVE,
        takenOverByUserId: null,
        takenOverAt: null,
        consecutiveFaqMisses: 0,
      },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_CONVERSATION_RETURNED_TO_BOT',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppConversation',
      entityId: conv.id,
      result: 'SUCCESS',
      description: 'Conversation returned to bot',
    });

    return updated;
  }

  async resolve(condominiumId: string, conversationId: string, user: JwtPayload) {
    const conv = await this.getConversationDetail(condominiumId, conversationId);

    const updated = await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        status: WhatsAppConversationStatus.RESOLVED,
        resolvedByUserId: user.sub,
        resolvedAt: new Date(),
      },
    });

    await this.auditService.log({
      condominiumId,
      userId: user.sub,
      action: 'WHATSAPP_CONVERSATION_RESOLVED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppConversation',
      entityId: conv.id,
      result: 'SUCCESS',
      description: 'Conversation resolved',
    });

    return updated;
  }

  async markRead(condominiumId: string, conversationId: string) {
    await this.getConversationDetail(condominiumId, conversationId);
    await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { unreadCountForAdmin: 0 },
    });
  }

  // ── Webhook Processing ───────────────────────────────────────────────────────

  async verifyWebhookHandshake(condominiumSlug: string, query: Record<string, string>) {
    const condominium = await this.prisma.condominium.findUnique({
      where: { slug: condominiumSlug },
      select: { id: true },
    });
    if (!condominium) throw new NotFoundException('Condominium not found');

    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId: condominium.id },
    });
    if (!credential) throw new UnauthorizedException('No credential configured');

    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode !== 'subscribe' || token !== credential.webhookVerifyToken) {
      throw new UnauthorizedException('Verification failed');
    }

    await this.prisma.whatsAppCredential.update({
      where: { condominiumId: condominium.id },
      data: { status: 'ACTIVE', verifiedAt: new Date() },
    });

    await this.auditService.log({
      condominiumId: condominium.id,
      userId: 'system',
      action: 'WHATSAPP_CREDENTIAL_VERIFIED',
      actionCategory: 'COMMUNICATIONS',
      module: 'WHATSAPP',
      entityType: 'WhatsAppCredential',
      entityId: credential.id,
      result: 'SUCCESS',
      description: 'Meta webhook handshake verified',
    });

    return challenge;
  }

  validateWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const metaAppSecret = this.configService.get<string>('whatsapp.metaAppSecret', '');
    return verifyHmacSha256(rawBody, signature, metaAppSecret);
  }

  async processWebhookPayload(condominiumSlug: string, payload: unknown): Promise<void> {
    const condominium = await this.prisma.condominium.findUnique({
      where: { slug: condominiumSlug },
      select: { id: true },
    });
    if (!condominium) return;

    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId: condominium.id },
    });
    if (!credential || credential.status !== 'ACTIVE') return;

    await this.prisma.whatsAppCredential.update({
      where: { condominiumId: condominium.id },
      data: { lastWebhookReceivedAt: new Date() },
    });

    const data = payload as Record<string, unknown>;
    const entries = (data.entry as Record<string, unknown>[]) ?? [];

    for (const entry of entries) {
      const changes = (entry.changes as Record<string, unknown>[]) ?? [];
      for (const change of changes) {
        const value = change.value as Record<string, unknown>;
        const messages = (value.messages as Record<string, unknown>[]) ?? [];
        const statuses = (value.statuses as Record<string, unknown>[]) ?? [];

        for (const msg of messages) {
          await this.processInboundMessage(condominium.id, credential, msg);
        }

        for (const status of statuses) {
          await this.processMessageStatus(status);
        }
      }
    }
  }

  private async processInboundMessage(
    condominiumId: string,
    credential: {
      id: string;
      phoneNumberId: string;
      accessTokenCiphertext: string;
      accessTokenIv: string;
      accessTokenAuthTag: string;
    },
    msg: Record<string, unknown>,
  ): Promise<void> {
    const metaMessageId = msg.id as string;
    const from = msg.from as string;
    const msgType = (msg.type as string) ?? 'text';
    const textContent = (msg.text as Record<string, string>)?.body ?? null;

    const existing = await this.prisma.whatsAppMessage.findUnique({ where: { metaMessageId } });
    if (existing) return;

    const phoneNumber = from.startsWith('+') ? from : `+${from}`;

    const adminPreference = await this.prisma.whatsAppNotificationPreference.findFirst({
      where: { condominiumId, personalPhoneNumber: phoneNumber },
      select: { id: true, personalPhoneVerifiedAt: true },
    });
    if (adminPreference) {
      await this.handleSystemChannelInbound({
        condominiumId,
        credential,
        phoneNumber,
        metaMessageId,
        textContent,
        msgType,
        preferenceId: adminPreference.id,
        alreadyVerified: Boolean(adminPreference.personalPhoneVerifiedAt),
      });
      return;
    }

    const conversation = await this.findOrCreateConversation(condominiumId, phoneNumber);

    const messageTypeMap: Record<string, string> = {
      text: 'TEXT',
      image: 'IMAGE',
      document: 'DOCUMENT',
      audio: 'AUDIO',
      video: 'VIDEO',
      sticker: 'STICKER',
      location: 'LOCATION',
      contacts: 'CONTACTS',
      interactive: 'INTERACTIVE',
      template: 'TEMPLATE',
    };

    const mediaMeta = extractMediaMeta(msg, msgType);

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: WhatsAppMessageDirection.INBOUND,
        messageType: (messageTypeMap[msgType] ?? 'UNSUPPORTED') as WhatsAppMessageType,
        textContent,
        metaMessageId,
        status: WhatsAppMessageStatus.RECEIVED,
        ...mediaMeta,
      },
    });

    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundAt: new Date(),
        unreadCountForAdmin: { increment: 1 },
      },
    });

    if (conversation.unregisteredContactId) {
      await this.prisma.whatsAppUnregisteredContact.update({
        where: { id: conversation.unregisteredContactId },
        data: { messageCount: { increment: 1 }, lastSeenAt: new Date() },
      });
    }

    if (conversation.status === WhatsAppConversationStatus.BOT_ACTIVE) {
      const botConfig = await this.getOrCreateBotConfig(condominiumId);
      await this.botService.processBotPipeline({
        conversation,
        inboundMessage: message,
        botConfig,
        phoneNumberId: credential.phoneNumberId,
        accessTokenCiphertext: credential.accessTokenCiphertext,
        accessTokenIv: credential.accessTokenIv,
        accessTokenAuthTag: credential.accessTokenAuthTag,
      });
    }
  }

  private async processMessageStatus(status: Record<string, unknown>): Promise<void> {
    const metaMessageId = status.id as string;
    const statusValue = (status.status as string)?.toUpperCase();

    const statusMap: Record<string, string> = {
      SENT: 'SENT',
      DELIVERED: 'DELIVERED',
      READ: 'READ',
      FAILED: 'FAILED',
    };

    const mappedStatus = statusMap[statusValue];
    if (!mappedStatus || !metaMessageId) return;

    await this.prisma.whatsAppMessage.updateMany({
      where: { metaMessageId },
      data: {
        status: mappedStatus as WhatsAppMessageStatus,
        ...(mappedStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        ...(mappedStatus === 'READ' ? { readAt: new Date() } : {}),
      },
    });
  }

  private async handleSystemChannelInbound(args: {
    condominiumId: string;
    credential: {
      phoneNumberId: string;
      accessTokenCiphertext: string;
      accessTokenIv: string;
      accessTokenAuthTag: string;
    };
    phoneNumber: string;
    metaMessageId: string;
    textContent: string | null;
    msgType: string;
    preferenceId: string;
    alreadyVerified: boolean;
  }): Promise<void> {
    const {
      condominiumId,
      credential,
      phoneNumber,
      metaMessageId,
      textContent,
      msgType,
      preferenceId,
      alreadyVerified,
    } = args;

    const conversation = await this.findOrCreateSystemConversation(condominiumId, phoneNumber);

    const messageTypeMap: Record<string, string> = {
      text: 'TEXT',
      image: 'IMAGE',
      document: 'DOCUMENT',
      audio: 'AUDIO',
      video: 'VIDEO',
      sticker: 'STICKER',
      location: 'LOCATION',
      contacts: 'CONTACTS',
      interactive: 'INTERACTIVE',
      template: 'TEMPLATE',
    };

    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: WhatsAppMessageDirection.INBOUND,
        messageType: (messageTypeMap[msgType] ?? 'UNSUPPORTED') as WhatsAppMessageType,
        textContent,
        metaMessageId,
        status: WhatsAppMessageStatus.RECEIVED,
      },
    });

    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { lastInboundAt: new Date() },
    });

    if (!alreadyVerified) {
      await this.prisma.whatsAppNotificationPreference.update({
        where: { id: preferenceId },
        data: { personalPhoneVerifiedAt: new Date() },
      });

      try {
        const encryptionKey = this.configService.get<string>('whatsapp.encryptionKey', '');
        const accessToken = decrypt(
          credential.accessTokenCiphertext,
          credential.accessTokenIv,
          credential.accessTokenAuthTag,
          encryptionKey,
        );
        const result = await this.metaClient.sendTextMessage(
          credential.phoneNumberId,
          accessToken,
          phoneNumber,
          'Canal de notificaciones activado. Las alertas de escalamiento llegarán aquí.',
        );
        await this.prisma.whatsAppMessage.create({
          data: {
            conversationId: conversation.id,
            direction: WhatsAppMessageDirection.OUTBOUND,
            messageType: WhatsAppMessageType.TEXT,
            textContent: null,
            sentByBot: true,
            metaMessageId: result.messageId || `system-confirm-${Date.now()}`,
            status: WhatsAppMessageStatus.SENT,
          },
        });
        await this.prisma.whatsAppConversation.update({
          where: { id: conversation.id },
          data: { lastOutboundAt: new Date() },
        });
      } catch (err) {
        this.logger.error(
          `[handleSystemChannelInbound] confirmation send failed: ${(err as Error).message}`,
        );
      }
    }
  }

  private async findOrCreateSystemConversation(condominiumId: string, phoneNumber: string) {
    const existing = await this.prisma.whatsAppConversation.findFirst({
      where: {
        condominiumId,
        phoneNumber,
        isSystemChannel: true,
        status: { not: WhatsAppConversationStatus.RESOLVED },
      },
    });
    if (existing) return existing;
    return this.prisma.whatsAppConversation.create({
      data: {
        condominiumId,
        phoneNumber,
        isSystemChannel: true,
        status: WhatsAppConversationStatus.BOT_ACTIVE,
      },
    });
  }

  private async findOrCreateConversation(condominiumId: string, phoneNumber: string) {
    const active = await this.prisma.whatsAppConversation.findFirst({
      where: {
        condominiumId,
        phoneNumber,
        status: { not: WhatsAppConversationStatus.RESOLVED },
      },
    });
    if (active) return active;

    const resident = await this.prisma.resident.findFirst({
      where: {
        condominiumId,
        OR: RESIDENT_PHONE_FIELDS.map((field) => ({ [field]: phoneNumber })),
        deletedAt: null,
      },
    });

    let unregisteredContactId: string | null = null;
    if (!resident) {
      const contact = await this.prisma.whatsAppUnregisteredContact.upsert({
        where: { condominiumId_phoneNumber: { condominiumId, phoneNumber } },
        create: { condominiumId, phoneNumber, lastSeenAt: new Date() },
        update: {
          conversationCount: { increment: 1 },
          lastSeenAt: new Date(),
        },
      });
      unregisteredContactId = contact.id;
    }

    return this.prisma.whatsAppConversation.create({
      data: {
        condominiumId,
        phoneNumber,
        residentId: resident?.id ?? null,
        unregisteredContactId,
        contactName: resident
          ? `${resident.firstName} ${resident.lastName}`
          : null,
        status: WhatsAppConversationStatus.BOT_ACTIVE,
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async getOrCreateBotConfig(condominiumId: string) {
    return this.prisma.whatsAppBotConfig.upsert({
      where: { condominiumId },
      create: { condominiumId },
      update: {},
    });
  }

  private async requireCredential(condominiumId: string) {
    const credential = await this.prisma.whatsAppCredential.findUnique({
      where: { condominiumId },
    });
    if (!credential) throw new NotFoundException('WhatsApp credential not configured');
    return credential;
  }

  private sanitizeCredential(
    credential: {
      id: string;
      condominiumId: string;
      phoneNumberId: string;
      phoneNumberDisplay: string;
      businessAccountId: string;
      webhookVerifyToken: string;
      status: string;
      verifiedAt: Date | null;
      lastWebhookReceivedAt: Date | null;
      lastApiErrorAt: Date | null;
      lastApiErrorMessage: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {
    return {
      id: credential.id,
      condominiumId: credential.condominiumId,
      phoneNumberId: credential.phoneNumberId,
      phoneNumberDisplay: credential.phoneNumberDisplay,
      businessAccountId: credential.businessAccountId,
      webhookVerifyToken: credential.webhookVerifyToken,
      status: credential.status,
      verifiedAt: credential.verifiedAt,
      lastWebhookReceivedAt: credential.lastWebhookReceivedAt,
      lastApiErrorAt: credential.lastApiErrorAt,
      lastApiErrorMessage: credential.lastApiErrorMessage,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}
