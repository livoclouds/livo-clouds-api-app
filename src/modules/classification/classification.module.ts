import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ReconciliationRulesModule } from '../reconciliation-rules/reconciliation-rules.module';

@Module({
  imports: [ReconciliationRulesModule],
  controllers: [ClassificationController],
  providers: [ClassificationService],
  exports: [ClassificationService],
})
export class ClassificationModule {}
