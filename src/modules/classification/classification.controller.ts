import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassificationService } from './classification.service';
import { ClassificationMetricsService } from './classification-metrics.service';
import { ManualMatchDto } from './dto/manual-match.dto';
import { ManualClassifyDto } from './dto/manual-classify.dto';
import { BulkReconcileDto } from './dto/bulk-reconcile.dto';
import { PrecisionQueryDto } from './dto/precision-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Classification')
@Controller('condominiums/:condominiumSlug')
@UseGuards(CondominiumAccessGuard)
export class ClassificationController {
  constructor(
    private readonly classificationService: ClassificationService,
    private readonly metricsService: ClassificationMetricsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('classification/precision')
  @RequirePermission('transactions.read')
  @ApiOperation({
    summary:
      'Classification precision metrics — override rates per matchSource and per rule (ENGINE-058)',
  })
  async getPrecision(
    @Request() req: { condominiumId: string },
    @Query() query: PrecisionQueryDto,
  ) {
    const metrics = await this.metricsService.getPrecisionMetrics(
      req.condominiumId,
      {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
    );
    return { data: metrics };
  }

  @Post('imports/:batchId/classify')
  @RequirePermission('transactions.override')
  @ApiOperation({ summary: 'Re-run classification for an import batch' })
  async reclassifyBatch(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('batchId') batchId: string,
  ) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, condominiumId: req.condominiumId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');

    const summary = await this.classificationService.reclassifyBatch(
      req.condominiumId,
      batchId,
      user.sub,
    );
    return { data: summary };
  }

  @Patch('transactions/:id/match')
  @RequirePermission('transactions.override')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Manually match a transaction to a resident' })
  async manualMatch(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') transactionId: string,
    @Body() dto: ManualMatchDto,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId: req.condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    await this.classificationService.manualMatch(
      req.condominiumId,
      transactionId,
      dto.residentId,
      user.sub,
    );
    return { data: { success: true } };
  }

  @Patch('transactions/:id/classify')
  @RequirePermission('transactions.override')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Manually classify a transaction with custom fields' })
  async manualClassify(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') transactionId: string,
    @Body() dto: ManualClassifyDto,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId: req.condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    await this.classificationService.manualClassify(
      req.condominiumId,
      transactionId,
      dto,
      user.sub,
    );
    return { data: { success: true } };
  }

  @Patch('transactions/:id/unmatch')
  @RequirePermission('transactions.override')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Remove resident match from a transaction' })
  async unmatch(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') transactionId: string,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, condominiumId: req.condominiumId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    await this.classificationService.unmatch(
      req.condominiumId,
      transactionId,
      user.sub,
    );
    return { data: { success: true } };
  }

  @Patch('transactions/:id/approve')
  @RequirePermission('transactions.override')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Approve a transaction so it affects official financial data' })
  async approveTransaction(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') transactionId: string,
  ) {
    await this.classificationService.approveTransaction(req.condominiumId, transactionId, user.sub);
    return { data: { success: true } };
  }

  @Patch('transactions/:id/ignore')
  @RequirePermission('transactions.override')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ignore a transaction so it is excluded from financial data' })
  async ignoreTransaction(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') transactionId: string,
  ) {
    await this.classificationService.ignoreTransaction(req.condominiumId, transactionId, user.sub);
    return { data: { success: true } };
  }

  @Patch('transactions/:id/reopen')
  @RequirePermission('transactions.override')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reopen a transaction back to PENDING reconciliation status' })
  async reopenTransaction(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') transactionId: string,
  ) {
    await this.classificationService.reopenTransaction(req.condominiumId, transactionId, user.sub);
    return { data: { success: true } };
  }

  @Post('transactions/bulk-reconcile')
  @RequirePermission('transactions.override')
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Bulk approve, ignore, or reopen multiple transactions' })
  async bulkReconcile(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: BulkReconcileDto,
  ) {
    const result = await this.classificationService.bulkReconcile(
      req.condominiumId,
      dto.ids,
      dto.action,
      user.sub,
    );
    return { data: result };
  }
}
