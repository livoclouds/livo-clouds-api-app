import { Controller, Get, Param, Query, Request, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { TransactionsService } from './transactions.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

@ApiTags('Transactions')
@Controller('condominiums/:condominiumSlug/transactions')
@UseGuards(CondominiumAccessGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'List transactions with filters and pagination' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query() query: ListTransactionsDto,
  ) {
    return this.transactionsService.findAll(req.condominiumId, query);
  }

  @Get('unmatched')
  @ApiOperation({ summary: 'List transactions pending classification review' })
  findUnmatched(
    @Request() req: { condominiumId: string },
    @Query() query: ListTransactionsDto,
  ) {
    return this.transactionsService.findUnmatched(req.condominiumId, query);
  }

  @Get('classified/export.csv')
  @Throttle({ burst: { limit: 2, ttl: 30_000 }, sustained: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Export Classified-PENDING transactions as a streamed CSV' })
  async exportClassified(
    @Request() req: { condominiumId: string },
    @Param('condominiumSlug') condominiumSlug: string,
    @Query() query: ListTransactionsDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const { stream, truncated } = await this.transactionsService.prepareClassifiedExport(
      req.condominiumId,
      query,
    );
    const filenameDate = new Date().toISOString().slice(0, 10);
    const filename = `classified-transactions_${condominiumSlug}_${filenameDate}.csv`;

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'no-store')
      // ENGINE-037: machine-readable truncation signal (the body is capped at
      // EXPORT_HARD_CAP rows). Headers must precede the stream on Fastify.
      .header('X-Export-Truncated', String(truncated));

    return reply.send(stream);
  }

  @Get('classified')
  @ApiOperation({ summary: 'List classified transactions (AUTO or MANUAL_OVERRIDE)' })
  findClassified(
    @Request() req: { condominiumId: string },
    @Query() query: ListTransactionsDto,
  ) {
    return this.transactionsService.findClassified(req.condominiumId, query);
  }

  @Get('reconciled/export.csv')
  @Throttle({ burst: { limit: 2, ttl: 30_000 }, sustained: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Export Reconciliation History as a streamed CSV' })
  async exportReconciled(
    @Request() req: { condominiumId: string },
    @Param('condominiumSlug') condominiumSlug: string,
    @Query() query: ListTransactionsDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const { stream, truncated } = await this.transactionsService.prepareReconciledExport(
      req.condominiumId,
      query,
    );
    const filenameDate = new Date().toISOString().slice(0, 10);
    const filename = `reconciliation-history_${condominiumSlug}_${filenameDate}.csv`;

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'no-store')
      // ENGINE-037: machine-readable truncation signal (the body is capped at
      // EXPORT_HARD_CAP rows). Headers must precede the stream on Fastify.
      .header('X-Export-Truncated', String(truncated));

    return reply.send(stream);
  }

  @Get('reconciled')
  @ApiOperation({ summary: 'List reconciled transactions (APPROVED or IGNORED)' })
  findReconciled(
    @Request() req: { condominiumId: string },
    @Query() query: ListTransactionsDto,
  ) {
    return this.transactionsService.findReconciled(req.condominiumId, query);
  }

  @Get(':id/audit-chain')
  @ApiOperation({ summary: 'Return chronological audit chain for a single transaction' })
  getAuditChain(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.transactionsService.getAuditChain(req.condominiumId, id);
  }
}
