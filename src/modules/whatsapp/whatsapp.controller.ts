import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { CreateResidentDto } from '../residents/dto/create-resident.dto';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppNotificationPreferenceService } from './whatsapp-notification-preference.service';
import { WhatsAppUnregisteredService } from './whatsapp-unregistered.service';
import { WhatsAppMediaService } from './whatsapp-media.service';
import { WhatsAppAnalyticsService } from './whatsapp-analytics.service';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';
import { UpdateBotConfigDto } from './dto/update-bot-config.dto';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import { ListFaqsDto } from './dto/list-faqs.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ReorderFaqsDto } from './dto/reorder-faqs.dto';
import { ListUnregisteredDto } from './dto/list-unregistered.dto';
import { UpdateUnregisteredContactDto } from './dto/update-unregistered.dto';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { TestNotificationDto } from './dto/test-notification.dto';
import { PushSubscriptionDto } from './dto/push-subscription.dto';
import { PushUnsubscribeDto } from './dto/push-unsubscribe.dto';
import { ValidateNumberDto } from './dto/validate-number.dto';
import { NormalizeResidentPhonesDto } from './dto/normalize-resident-phones.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('WhatsApp')
@Controller('condominiums/:condominiumSlug/communications/whatsapp')
@UseGuards(CondominiumAccessGuard)
export class WhatsAppController {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly notificationPreferenceService: WhatsAppNotificationPreferenceService,
    private readonly unregisteredService: WhatsAppUnregisteredService,
    private readonly mediaService: WhatsAppMediaService,
    private readonly analyticsService: WhatsAppAnalyticsService,
  ) {}

  // ── Credentials ─────────────────────────────────────────────────────────────

  @Get('credentials')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Get WhatsApp credential (sanitized)' })
  getCredential(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.getCredential(req.condominiumId);
  }

  @Patch('credentials')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Create or update WhatsApp credential' })
  upsertCredential(
    @Request() req: { condominiumId: string },
    @Body() dto: UpsertCredentialDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.upsertCredential(req.condominiumId, dto, user);
  }

  @Delete('credentials')
  @RequirePermission('communications.send')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke WhatsApp credential' })
  deleteCredential(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.deleteCredential(req.condominiumId, user);
  }

  @Post('credentials/validate-number')
  @RequirePermission('communications.send')
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 15, ttl: 60_000 } })
  @ApiOperation({ summary: 'Validate whether a phone number is ready for WhatsApp Business' })
  validateNumber(
    @Request() req: { condominiumId: string },
    @Body() dto: ValidateNumberDto,
  ) {
    return this.whatsAppService.validateNumber(req.condominiumId, dto);
  }

  @Post('residents/normalize-phones')
  @RequirePermission('communications.send')
  @Throttle({ burst: { limit: 3, ttl: 10_000 }, sustained: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Dry-run or apply resident phone-number normalization' })
  normalizeResidentPhones(
    @Request() req: { condominiumId: string },
    @Body() dto: NormalizeResidentPhonesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.normalizeResidentPhones(req.condominiumId, dto, user);
  }

  @Post('credentials/test-connection')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Test connection to Meta Graph API' })
  testConnection(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.testConnection(req.condominiumId);
  }

  // ── Bot Config ───────────────────────────────────────────────────────────────

  @Get('bot-config')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Get bot configuration' })
  getBotConfig(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.getBotConfig(req.condominiumId);
  }

  @Patch('bot-config')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Update bot configuration' })
  updateBotConfig(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateBotConfigDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.updateBotConfig(req.condominiumId, dto, user);
  }

  // ── FAQs ─────────────────────────────────────────────────────────────────────

  @Get('faqs/categories')
  @ApiOperation({ summary: 'List distinct FAQ categories' })
  getFaqCategories(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.getFaqCategories(req.condominiumId);
  }

  // Declared before `faqs/:faqId` so the static segment is not captured as a param.
  @Get('faqs/usage-stats')
  @ApiOperation({ summary: 'Lightweight FAQ usage statistics' })
  getFaqUsageStats(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.getFaqUsageStats(req.condominiumId);
  }

  @Get('faqs')
  @ApiOperation({ summary: 'List FAQs' })
  listFaqs(@Request() req: { condominiumId: string }, @Query() query: ListFaqsDto) {
    return this.whatsAppService.listFaqs(req.condominiumId, query);
  }

  @Get('faqs/:faqId')
  @ApiOperation({ summary: 'Get a single FAQ' })
  getFaq(@Request() req: { condominiumId: string }, @Param('faqId') faqId: string) {
    return this.whatsAppService.getFaq(req.condominiumId, faqId);
  }

  @Post('faqs')
  @RequirePermission('communications.send')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 40, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create FAQ' })
  createFaq(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateFaqDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.createFaq(req.condominiumId, dto, user);
  }

  @Patch('faqs/reorder')
  @RequirePermission('communications.send')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reorder FAQs by ID list' })
  reorderFaqs(@Request() req: { condominiumId: string }, @Body() dto: ReorderFaqsDto) {
    return this.whatsAppService.reorderFaqs(req.condominiumId, dto);
  }

  @Patch('faqs/:faqId')
  @RequirePermission('communications.send')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 40, ttl: 60_000 } })
  @ApiOperation({ summary: 'Update FAQ' })
  updateFaq(
    @Request() req: { condominiumId: string },
    @Param('faqId') faqId: string,
    @Body() dto: UpdateFaqDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.updateFaq(req.condominiumId, faqId, dto, user);
  }

  @Delete('faqs/:faqId')
  @RequirePermission('communications.send')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete FAQ' })
  deleteFaq(
    @Request() req: { condominiumId: string },
    @Param('faqId') faqId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.deleteFaq(req.condominiumId, faqId, user);
  }

  // ── Conversations ────────────────────────────────────────────────────────────

  @Get('conversations/unread-count')
  @ApiOperation({ summary: 'Get total unread count across all conversations' })
  getUnreadCount(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.getUnreadCount(req.condominiumId);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations' })
  listConversations(
    @Request() req: { condominiumId: string },
    @Query() query: ListConversationsDto,
  ) {
    return this.whatsAppService.listConversations(req.condominiumId, query);
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'Get conversation detail with last 50 messages' })
  getConversation(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
  ) {
    return this.whatsAppService.getConversationDetail(req.condominiumId, conversationId);
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'List all messages in a conversation' })
  listMessages(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
  ) {
    return this.whatsAppService.listMessages(req.condominiumId, conversationId);
  }

  @Post('conversations/:conversationId/messages')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Send a text message' })
  sendMessage(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.sendMessage(req.condominiumId, conversationId, dto, user);
  }

  @Post('conversations/:conversationId/take-over')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Admin take over conversation from bot' })
  takeOver(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.takeOver(req.condominiumId, conversationId, user);
  }

  @Post('conversations/:conversationId/return-to-bot')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Return conversation to bot handling' })
  returnToBot(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.returnToBot(req.condominiumId, conversationId, user);
  }

  @Post('conversations/:conversationId/resolve')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Resolve a conversation' })
  resolve(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.resolve(req.condominiumId, conversationId, user);
  }

  @Post('conversations/:conversationId/mark-read')
  @RequirePermission('communications.read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark conversation as read' })
  markRead(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
  ) {
    return this.whatsAppService.markRead(req.condominiumId, conversationId);
  }

  @Get('conversations/:conversationId/media/:messageId')
  @ApiOperation({ summary: 'Stream media for a message via the lazy Meta proxy' })
  async getMedia(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ): Promise<void> {
    try {
      const { stream, contentType, contentLength } =
        await this.mediaService.fetchMediaStream(
          req.condominiumId,
          conversationId,
          messageId,
          user,
        );
      res.header('Content-Type', contentType);
      if (contentLength) res.header('Content-Length', contentLength);
      res.header('Cache-Control', 'private, max-age=300');
      res.header('X-Content-Type-Options', 'nosniff');
      await res.send(Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]));
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 429) {
        const response = err.getResponse();
        const retryAfterSec =
          typeof response === 'object' && response
            ? (response as { retryAfterSec?: number }).retryAfterSec
            : undefined;
        if (retryAfterSec) res.header('Retry-After', String(retryAfterSec));
      }
      throw err;
    }
  }

  // ── Unregistered Contacts ────────────────────────────────────────────────────

  @Get('unregistered')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'List unregistered contacts' })
  listUnregistered(
    @Request() req: { condominiumId: string },
    @Query() query: ListUnregisteredDto,
  ) {
    return this.unregisteredService.list(req.condominiumId, query);
  }

  @Patch('unregistered/:id')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Update captured data, notes, or status of an unregistered contact' })
  updateUnregistered(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: UpdateUnregisteredContactDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.unregisteredService.update(req.condominiumId, id, dto, user);
  }

  @Post('unregistered/:id/register-as-resident')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Promote an unregistered contact to a registered resident' })
  registerUnregisteredAsResident(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: CreateResidentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.unregisteredService.registerAsResident(req.condominiumId, id, dto, user);
  }

  @Post('unregistered/:id/ignore')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Mark an unregistered contact as ignored' })
  ignoreUnregistered(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.unregisteredService.ignore(req.condominiumId, id, user);
  }

  // ── Notification Preferences ─────────────────────────────────────────────────

  @Get('notification-preference')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Get current user notification preference for this condominium' })
  getNotificationPreference(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationPreferenceService.getForCurrentUser(req.condominiumId, user.sub);
  }

  @Patch('notification-preference')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Update notification preference' })
  updateNotificationPreference(
    @Request() req: { condominiumId: string },
    @Body() dto: UpdateNotificationPreferenceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationPreferenceService.updateForCurrentUser(req.condominiumId, user, dto);
  }

  @Post('notification-preference/test-whatsapp')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Send a test WhatsApp notification to the admin personal number' })
  testNotification(
    @Request() req: { condominiumId: string },
    @Body() dto: TestNotificationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationPreferenceService.sendTestWhatsApp(
      req.condominiumId,
      user.sub,
      dto.personalPhoneNumber,
    );
  }

  @Post('notification-preference/push-subscribe')
  @RequirePermission('communications.send')
  @Throttle({ burst: { limit: 20, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a Web Push subscription for this device (multi-device)' })
  pushSubscribe(
    @Request() req: { condominiumId: string },
    @Body() dto: PushSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationPreferenceService.savePushSubscription(
      req.condominiumId,
      user.sub,
      dto.subscription,
    );
  }

  @Post('notification-preference/push-unsubscribe')
  @RequirePermission('communications.send')
  @Throttle({ burst: { limit: 20, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a Web Push subscription (this device, or all when no endpoint)' })
  pushUnsubscribe(
    @Request() req: { condominiumId: string },
    @Body() dto: PushUnsubscribeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationPreferenceService.removePushSubscription(
      req.condominiumId,
      user.sub,
      dto.endpoint,
    );
  }

  // ── Analytics ────────────────────────────────────────────────────────────────

  @Get('analytics')
  @RequirePermission('communications.send')
  @ApiOperation({ summary: 'Lightweight communications analytics summary' })
  getAnalytics(
    @Request() req: { condominiumId: string },
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getSummary(req.condominiumId, query);
  }
}
