import { Module } from '@nestjs/common';
import { ReconciliationRulesController } from './reconciliation-rules.controller';
import { ReconciliationRulesService } from './reconciliation-rules.service';

// ENGINE-010 (Phase 6): no ClassificationModule import — the orchestration
// endpoints (GET system / POST apply-pending) live on RuleApplicationController
// in ClassificationModule, so the dependency is strictly one-way:
// Classification → ReconciliationRules.
@Module({
  controllers: [ReconciliationRulesController],
  providers: [ReconciliationRulesService],
  exports: [ReconciliationRulesService],
})
export class ReconciliationRulesModule {}
