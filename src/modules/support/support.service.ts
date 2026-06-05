import { Injectable } from '@nestjs/common';
import { HelpVoteValue, SupportTicket } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/types';
import { StorageService } from '../storage/storage.service';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { HelpVoteWire } from './dto/submit-feedback.dto';
import {
  CreateTicketDto,
  MODULE_TO_PRISMA,
  MODULE_TO_WIRE,
  PRIORITY_TO_PRISMA,
  PRIORITY_TO_WIRE,
  REQUEST_TYPE_TO_PRISMA,
  REQUEST_TYPE_TO_WIRE,
  STATUS_TO_WIRE,
} from './dto/create-ticket.dto';

export interface UploadedScreenshot {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface ArticleMetric {
  viewCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  myVote: HelpVoteWire | null;
}

export interface TicketView {
  id: string;
  requestType: string;
  priority: string;
  module: string;
  description: string;
  status: string;
  screenshotUrl: string | null;
  createdAt: Date;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-120) || 'screenshot';
}

function wireVoteOf(value: HelpVoteValue | null | undefined): HelpVoteWire | null {
  if (value === HelpVoteValue.HELPFUL) return 'helpful';
  if (value === HelpVoteValue.NOT_HELPFUL) return 'notHelpful';
  return null;
}

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ─── Article metrics (global, not tenant-scoped) ──────────────────────────

  async recordView(slug: string): Promise<{ slug: string; viewCount: number }> {
    const metric = await this.prisma.helpArticleMetric.upsert({
      where: { slug },
      create: { slug, viewCount: 1 },
      update: { viewCount: { increment: 1 } },
      select: { slug: true, viewCount: true },
    });
    return metric;
  }

  async submitFeedback(
    slug: string,
    userId: string,
    value: HelpVoteWire | null,
  ): Promise<{
    slug: string;
    helpfulCount: number;
    notHelpfulCount: number;
    myVote: HelpVoteWire | null;
  }> {
    const prismaValue: HelpVoteValue | null =
      value === 'helpful'
        ? HelpVoteValue.HELPFUL
        : value === 'notHelpful'
          ? HelpVoteValue.NOT_HELPFUL
          : null;

    const { helpfulCount, notHelpfulCount } = await this.prisma.$transaction(
      async (tx) => {
        // Ensure the aggregate row exists (lazy create), then mutate the vote.
        await tx.helpArticleMetric.upsert({
          where: { slug },
          create: { slug },
          update: {},
        });

        if (prismaValue === null) {
          await tx.helpArticleVote.deleteMany({ where: { slug, userId } });
        } else {
          await tx.helpArticleVote.upsert({
            where: { slug_userId: { slug, userId } },
            create: { slug, userId, value: prismaValue },
            update: { value: prismaValue },
          });
        }

        const [helpful, notHelpful] = await Promise.all([
          tx.helpArticleVote.count({
            where: { slug, value: HelpVoteValue.HELPFUL },
          }),
          tx.helpArticleVote.count({
            where: { slug, value: HelpVoteValue.NOT_HELPFUL },
          }),
        ]);

        await tx.helpArticleMetric.update({
          where: { slug },
          data: { helpfulCount: helpful, notHelpfulCount: notHelpful },
        });

        return { helpfulCount: helpful, notHelpfulCount: notHelpful };
      },
    );

    return { slug, helpfulCount, notHelpfulCount, myVote: value ?? null };
  }

  async getMetrics(
    slugs: string[],
    userId: string,
  ): Promise<{ metrics: Record<string, ArticleMetric> }> {
    const unique = Array.from(new Set(slugs));

    const [metrics, votes] = await Promise.all([
      this.prisma.helpArticleMetric.findMany({
        where: { slug: { in: unique } },
        select: {
          slug: true,
          viewCount: true,
          helpfulCount: true,
          notHelpfulCount: true,
        },
      }),
      this.prisma.helpArticleVote.findMany({
        where: { slug: { in: unique }, userId },
        select: { slug: true, value: true },
      }),
    ]);

    const metricBySlug = new Map(metrics.map((m) => [m.slug, m]));
    const voteBySlug = new Map(votes.map((v) => [v.slug, v.value]));

    const out: Record<string, ArticleMetric> = {};
    for (const slug of unique) {
      const m = metricBySlug.get(slug);
      out[slug] = {
        viewCount: m?.viewCount ?? 0,
        helpfulCount: m?.helpfulCount ?? 0,
        notHelpfulCount: m?.notHelpfulCount ?? 0,
        myVote: wireVoteOf(voteBySlug.get(slug)),
      };
    }
    return { metrics: out };
  }

  // ─── Support tickets (tenant-scoped) ──────────────────────────────────────

  async createTicket(
    condominiumId: string,
    userId: string,
    dto: CreateTicketDto,
    file?: UploadedScreenshot,
  ): Promise<TicketView> {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        condominiumId,
        userId,
        requestType: REQUEST_TYPE_TO_PRISMA[dto.requestType],
        priority: PRIORITY_TO_PRISMA[dto.priority],
        module: MODULE_TO_PRISMA[dto.module],
        description: dto.description,
      },
    });

    let screenshotUrl: string | null = null;
    if (file && this.storage.isConfigured()) {
      const key = `condominiums/${condominiumId}/support/${ticket.id}/${sanitizeFileName(file.originalname)}`;
      await this.storage.uploadFile(key, file.buffer, file.mimetype, {
        userId,
        condominiumId,
        byteSize: file.size,
      });
      await this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { screenshotKey: key },
      });
      screenshotUrl = await this.storage.getPresignedUrl(key, 3600, {
        userId,
        condominiumId,
      });
    }

    return this.toTicketView(ticket, screenshotUrl);
  }

  async listMyTickets(
    condominiumId: string,
    userId: string,
    query: ListTicketsDto,
  ): Promise<PaginatedResult<TicketView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { condominiumId, userId };

    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    const data = await Promise.all(
      rows.map(async (ticket) => {
        const url =
          ticket.screenshotKey && this.storage.isConfigured()
            ? await this.storage.getPresignedUrl(
                ticket.screenshotKey,
                3600,
                { userId, condominiumId },
                false,
              )
            : null;
        return this.toTicketView(ticket, url);
      }),
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private toTicketView(
    ticket: SupportTicket,
    screenshotUrl: string | null,
  ): TicketView {
    return {
      id: ticket.id,
      requestType: REQUEST_TYPE_TO_WIRE[ticket.requestType],
      priority: PRIORITY_TO_WIRE[ticket.priority],
      module: MODULE_TO_WIRE[ticket.module],
      description: ticket.description,
      status: STATUS_TO_WIRE[ticket.status],
      screenshotUrl,
      createdAt: ticket.createdAt,
    };
  }
}
