import { forwardRef, Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ReconciliationRulesModule } from '../reconciliation-rules/reconciliation-rules.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => ReconciliationRulesModule), SettingsModule],
  controllers: [ClassificationController],
  providers: [ClassificationService],
  exports: [ClassificationService],
})
export class ClassificationModule {}
