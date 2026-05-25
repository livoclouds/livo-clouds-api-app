import { forwardRef, Module } from '@nestjs/common';
import { ReconciliationRulesController } from './reconciliation-rules.controller';
import { ReconciliationRulesService } from './reconciliation-rules.service';
import { ClassificationModule } from '../classification/classification.module';

@Module({
  imports: [forwardRef(() => ClassificationModule)],
  controllers: [ReconciliationRulesController],
  providers: [ReconciliationRulesService],
  exports: [ReconciliationRulesService],
})
export class ReconciliationRulesModule {}
