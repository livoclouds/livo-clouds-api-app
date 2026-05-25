import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  Inject,
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
import { ClassificationService } from '../classification/classification.service';
import { ReconciliationRulesService } from './reconciliation-rules.service';
import { CreateReconciliationRuleDto } from './dto/create-reconciliation-rule.dto';
import { UpdateReconciliationRuleDto } from './dto/update-reconciliation-rule.dto';
import { ListReconciliationRulesDto } from './dto/list-reconciliation-rules.dto';
import { ReorderReconciliationRulesDto } from './dto/reorder-reconciliation-rules.dto';

@ApiTags('ReconciliationRules')
@Controller('condominiums/:condominiumSlug/settings/reconciliation-rules')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class ReconciliationRulesController {
  constructor(
    private readonly service: ReconciliationRulesService,
    @Inject(forwardRef(() => ClassificationService))
    private readonly classification: ClassificationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List reconciliation rules for a condominium' })
  async findAll(
    @Request() req: { condominiumId: string },
    @Query() dto: ListReconciliationRulesDto,
  ) {
    return this.service.findAll(req.condominiumId, dto);
  }

  @Get('pending-changes')
  @ApiOperation({
    summary:
      'List rule changes that have not been reapplied to pending transactions yet, with the count of pending transactions.',
  })
  async pendingChanges(@Request() req: { condominiumId: string }) {
    return this.service.getPendingChanges(req.condominiumId);
  }

  @Post('apply-pending')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({
    summary:
      'Reapply the current active rules to every NEEDS_REVIEW + PENDING transaction in the tenant and mark every queued rule change as applied.',
  })
  async applyPending(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const summary = await this.classification.reapplyToPending(
      req.condominiumId,
      user.sub,
    );
    const appliedChanges = await this.service.markAllChangesApplied(
      req.condominiumId,
      user.sub,
    );
    return { ...summary, appliedChanges };
  }

  @Post('discard-pending')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({
    summary:
      'Revert all unapplied TOGGLED rule changes, restoring each rule to its state before the pending toggles.',
  })
  async discardPending(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.discardPendingToggles(req.condominiumId, user.sub);
  }

  @Post('changes/:changeId/accept')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({
    summary:
      'Accept a single pending change log entry, marking it as applied without triggering re-classification.',
  })
  async acceptChange(
    @Request() req: { condominiumId: string },
    @Param('changeId') changeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.acceptChange(req.condominiumId, changeId, user.sub);
  }

  @Post('changes/:changeId/discard')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({
    summary:
      'Discard a single pending rule change. Reverts the rule to its pre-mutation state (recreates for DELETED, deletes for CREATED, restores fields for UPDATED/TOGGLED) and cascades to any later unapplied entries for the same rule.',
  })
  async discardChange(
    @Request() req: { condominiumId: string },
    @Param('changeId') changeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.discardSingleChange(
      req.condominiumId,
      changeId,
      user.sub,
    );
  }

  @Post('reorder')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({
    summary:
      'Reorder reconciliation rules. The body must list every rule of the condominium exactly once in the new desired order.',
  })
  async reorder(
    @Request() req: { condominiumId: string },
    @Body() dto: ReorderReconciliationRulesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reorder(req.condominiumId, dto.ruleIds, user.sub);
  }

  @Post()
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create a reconciliation rule' })
  async create(
    @Request() req: { condominiumId: string },
    @Body() dto: CreateReconciliationRuleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(req.condominiumId, dto, user.sub);
  }

  @Patch(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update a reconciliation rule' })
  async update(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @Body() dto: UpdateReconciliationRuleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(req.condominiumId, id, dto, user.sub);
  }

  @Patch(':id/toggle-active')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Toggle isActive on a reconciliation rule' })
  async toggleActive(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.toggleActive(req.condominiumId, id, user.sub);
  }

  @Delete(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Delete a reconciliation rule' })
  async remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.remove(req.condominiumId, id, user.sub);
    return { success: true };
  }
}
