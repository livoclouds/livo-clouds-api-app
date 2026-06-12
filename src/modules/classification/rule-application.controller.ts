import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { ClassificationService } from './classification.service';
import { ReconciliationRulesService } from '../reconciliation-rules/reconciliation-rules.service';

// ENGINE-010 (Phase 6): these two endpoints — the only rules → classification
// edges — moved here verbatim from ReconciliationRulesController. Hosting them
// in ClassificationModule (which already imports ReconciliationRulesModule)
// breaks the forwardRef cycle while keeping URLs and response shapes
// byte-identical.
@ApiTags('ReconciliationRules')
@Controller('condominiums/:condominiumSlug/settings/reconciliation-rules')
@UseGuards(CondominiumAccessGuard)
export class RuleApplicationController {
  constructor(
    private readonly classification: ClassificationService,
    private readonly rulesService: ReconciliationRulesService,
  ) {}

  @Get('system')
  @ApiOperation({
    summary:
      "Read-only catalog of the classification engine's built-in (hardcoded) rules — concept keywords, unit prefixes, recognized months and behavioral passes. Lets the UI surface the engine's 'system rules' next to the editable Pass-0 rules. Informational; no manage permission required.",
  })
  getSystemRules() {
    return this.classification.getSystemRulesCatalog();
  }

  @Post('apply-pending')
  @RequirePermission('paymentRules.manage')
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
    const appliedChanges = await this.rulesService.markAllChangesApplied(
      req.condominiumId,
      user.sub,
    );
    return { ...summary, appliedChanges };
  }
}
