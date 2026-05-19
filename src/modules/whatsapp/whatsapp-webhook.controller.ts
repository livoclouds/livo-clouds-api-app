import {
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { WhatsAppService } from './whatsapp.service';

@ApiTags('WhatsApp Webhook')
@Controller('webhook/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Public()
  @Get(':condominiumSlug')
  @ApiOperation({ summary: 'Meta webhook verification handshake' })
  async verifyWebhook(
    @Param('condominiumSlug') condominiumSlug: string,
    @Query() query: Record<string, string>,
  ) {
    try {
      return this.whatsAppService.verifyWebhookHandshake(condominiumSlug, query);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Verification failed');
    }
  }

  @Public()
  @Post(':condominiumSlug')
  @HttpCode(200)
  @ApiOperation({ summary: 'Meta inbound webhook receiver' })
  async receiveWebhook(
    @Param('condominiumSlug') condominiumSlug: string,
    @Req() req: RawBodyRequest<FastifyRequest>,
  ) {
    const signature = (req.headers['x-hub-signature-256'] as string) ?? '';
    const rawBody = req.rawBody;

    if (!rawBody || !signature) {
      throw new UnauthorizedException('Missing signature or body');
    }

    if (!this.whatsAppService.validateWebhookSignature(rawBody, signature)) {
      this.logger.warn(`Webhook signature mismatch for condominium: ${condominiumSlug}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = req.body as unknown;

    Promise.resolve()
      .then(() => this.whatsAppService.processWebhookPayload(condominiumSlug, payload))
      .catch((err: Error) =>
        this.logger.error(`Webhook processing error for ${condominiumSlug}: ${err.message}`),
      );

    return { status: 'ok' };
  }
}
