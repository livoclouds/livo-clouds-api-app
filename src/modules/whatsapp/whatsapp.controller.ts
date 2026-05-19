import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload, UserRole } from '../../common/types';
import { WhatsAppService } from './whatsapp.service';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';
import { UpdateBotConfigDto } from './dto/update-bot-config.dto';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import { ListFaqsDto } from './dto/list-faqs.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ReorderFaqsDto } from './dto/reorder-faqs.dto';

@ApiTags('WhatsApp')
@Controller('condominiums/:condominiumSlug/communications/whatsapp')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class WhatsAppController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  // ── Credentials ─────────────────────────────────────────────────────────────

  @Get('credentials')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Get WhatsApp credential (sanitized)' })
  getCredential(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.getCredential(req.condominiumId);
  }

  @Patch('credentials')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create or update WhatsApp credential' })
  upsertCredential(
    @Request() req: { condominiumId: string },
    @Body() dto: UpsertCredentialDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.upsertCredential(req.condominiumId, dto, user);
  }

  @Delete('credentials')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke WhatsApp credential' })
  deleteCredential(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.deleteCredential(req.condominiumId, user);
  }

  @Post('credentials/validate-number')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Validate the configured WhatsApp Business phone number' })
  validateNumber(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.validateNumber(req.condominiumId);
  }

  @Post('credentials/test-connection')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Test connection to Meta Graph API' })
  testConnection(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.testConnection(req.condominiumId);
  }

  // ── Bot Config ───────────────────────────────────────────────────────────────

  @Get('bot-config')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Get bot configuration' })
  getBotConfig(@Request() req: { condominiumId: string }) {
    return this.whatsAppService.getBotConfig(req.condominiumId);
  }

  @Patch('bot-config')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create FAQ' })
  createFaq(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateFaqDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.createFaq(req.condominiumId, dto, user);
  }

  @Patch('faqs/reorder')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Reorder FAQs by ID list' })
  reorderFaqs(@Request() req: { condominiumId: string }, @Body() dto: ReorderFaqsDto) {
    return this.whatsAppService.reorderFaqs(req.condominiumId, dto);
  }

  @Patch('faqs/:faqId')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Admin take over conversation from bot' })
  takeOver(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.takeOver(req.condominiumId, conversationId, user);
  }

  @Post('conversations/:conversationId/return-to-bot')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Return conversation to bot handling' })
  returnToBot(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.returnToBot(req.condominiumId, conversationId, user);
  }

  @Post('conversations/:conversationId/resolve')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Resolve a conversation' })
  resolve(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.whatsAppService.resolve(req.condominiumId, conversationId, user);
  }

  @Post('conversations/:conversationId/mark-read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark conversation as read' })
  markRead(
    @Request() req: { condominiumId: string },
    @Param('conversationId') conversationId: string,
  ) {
    return this.whatsAppService.markRead(req.condominiumId, conversationId);
  }
}
