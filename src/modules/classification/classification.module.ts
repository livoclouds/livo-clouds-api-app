import { forwardRef, Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { BatchClassificationService } from './batch-classification.service';
import { ManualClassificationService } from './manual-classification.service';
import { ClassificationMetricsService } from './classification-metrics.service';
import { ReconciliationRulesModule } from '../reconciliation-rules/reconciliation-rules.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => ReconciliationRulesModule), ReconciliationModule, SettingsModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, BatchClassificationService, ManualClassificationService, ClassificationMetricsService],
  exports: [ClassificationService],
})
export class ClassificationModule {}
