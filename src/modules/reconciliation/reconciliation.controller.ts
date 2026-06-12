import { Body, Controller, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BulkReconcileDto } from '../classification/dto/bulk-reconcile.dto';
import { ReconciliationLifecycleService } from './reconciliation-lifecycle.service';

// ENGINE-040: the reconciliation WRITE routes moved here from
// ClassificationController. URL paths, guards, permissions, throttles and
// response shapes are byte-identical — the web proxies depend on them.
@ApiTags('Reconciliation')
@Controller('condominiums/:condominiumSlug')
@UseGuards(CondominiumAccessGuard)
export class ReconciliationController {
  constructor(private readonly lifecycle: ReconciliationLifecycleService) {}

  @Patch('transactions/:id/approve')
  @RequirePermission('transactions.override')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Approve a transaction so it affects official financial data' })
  async approveTransaction(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Param('id') transactionId: string,
  ) {
    await this.lifecycle.approveTransaction(req.condominiumId, transactionId, user.sub);
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
    await this.lifecycle.ignoreTransaction(req.condominiumId, transactionId, user.sub);
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
    await this.lifecycle.reopenTransaction(req.condominiumId, transactionId, user.sub);
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
    const result = await this.lifecycle.bulkReconcile(
      req.condominiumId,
      dto.ids,
      dto.action,
      user.sub,
    );
    return { data: result };
  }
}
