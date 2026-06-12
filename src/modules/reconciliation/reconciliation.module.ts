import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationLifecycleService } from './reconciliation-lifecycle.service';
import { SummaryRecomputeService } from './summary-recompute.service';
import { TerracePaymentLinkService } from './terrace-payment-link.service';

// ENGINE-008/040 (Phase 6): reconciliation lifecycle, summary recompute and
// terrace payment links — one-way dependency target for ClassificationModule.
@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationLifecycleService, SummaryRecomputeService, TerracePaymentLinkService],
  exports: [ReconciliationLifecycleService, SummaryRecomputeService, TerracePaymentLinkService],
})
export class ReconciliationModule {}
