import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipCondominiumScope } from '../../common/decorators/skip-condominium-scope.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { isValidSupportSlug } from './dto/article-slug.util';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { GetMetricsDto } from './dto/get-metrics.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { SupportService, UploadedScreenshot } from './support.service';

const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// The class-level CondominiumAccessGuard enforces tenant scope for the ticket
// routes; the global metric routes opt out via @SkipCondominiumScope() — their
// `:slug` is an ARTICLE slug, which the guard would otherwise misread as a
// condominium slug (ENGINE-057). No @RequirePermission anywhere: the Support
// Center is available to every authenticated role, and any member may file a
// ticket.
@ApiTags('Support')
@UseGuards(CondominiumAccessGuard)
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // ─── Article metrics (global) ─────────────────────────────────────────────

  @Post('support/articles/:slug/view')
  @SkipCondominiumScope()
  @Throttle({ sustained: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Increment the view counter for an article' })
  recordView(@Param('slug') slug: string) {
    this.assertSlug(slug);
    return this.support.recordView(slug);
  }

  @Post('support/articles/:slug/feedback')
  @SkipCondominiumScope()
  @ApiOperation({ summary: 'Cast, change, or retract helpful feedback' })
  submitFeedback(
    @Param('slug') slug: string,
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser() user: JwtPayload,
  ) {
    this.assertSlug(slug);
    return this.support.submitFeedback(slug, user.sub, dto.value ?? null);
  }

  @Post('support/articles/metrics')
  @SkipCondominiumScope()
  @ApiOperation({ summary: 'Batch-fetch engagement metrics for article slugs' })
  getMetrics(@Body() dto: GetMetricsDto, @CurrentUser() user: JwtPayload) {
    return this.support.getMetrics(dto.slugs, user.sub);
  }

  // ─── Support tickets (tenant-scoped) ──────────────────────────────────────

  @Post('condominiums/:condominiumSlug/support/tickets')
  @Throttle({ sustained: { limit: 20, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Create a support ticket (optional screenshot)' })
  async createTicket(
    @Request() req: FastifyRequest & { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const fields: Record<string, unknown> = {};
    let file: UploadedScreenshot | undefined;

    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'screenshot') {
            // Drain unexpected file parts so the stream doesn't stall.
            for await (const _chunk of part.file) void _chunk;
            continue;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk as Buffer);
          const buffer = Buffer.concat(chunks);
          file = {
            buffer,
            originalname: part.filename,
            mimetype: part.mimetype,
            size: buffer.length,
          };
        } else {
          fields[part.fieldname] = part.value;
        }
      }
    } else {
      Object.assign(fields, (req.body as Record<string, unknown>) ?? {});
    }

    const dto = plainToInstance(CreateTicketDto, fields, {
      enableImplicitConversion: true,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidUnknownValues: false,
    });
    if (errors.length > 0) {
      const messages = errors.flatMap((e) =>
        Object.values(e.constraints ?? {}),
      );
      throw new BadRequestException(
        messages.length ? messages : 'Invalid support ticket payload',
      );
    }

    if (file) {
      if (!SCREENSHOT_MIME_TYPES.includes(file.mimetype)) {
        throw new BadRequestException(
          'Screenshot must be a PNG, JPG, or WEBP image',
        );
      }
      if (file.size > SCREENSHOT_MAX_BYTES) {
        throw new BadRequestException('Screenshot exceeds the 5 MB limit');
      }
    }

    return this.support.createTicket(req.condominiumId, user.sub, dto, file);
  }

  @Get('condominiums/:condominiumSlug/support/tickets/mine')
  @ApiOperation({ summary: 'List my support tickets (paginated)' })
  listMyTickets(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Query() query: ListTicketsDto,
  ) {
    return this.support.listMyTickets(req.condominiumId, user.sub, query);
  }

  private assertSlug(slug: string): void {
    if (!isValidSupportSlug(slug)) {
      throw new BadRequestException('Invalid article slug');
    }
  }
}
