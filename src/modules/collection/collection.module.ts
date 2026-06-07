import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CollectionController } from './collection.controller';
import { CollectionService } from './collection.service';

@Module({
  imports: [AuditModule],
  controllers: [CollectionController],
  providers: [CollectionService],
  // Exported so the resident dossier's ARCO packet (Capa 2E) can reuse
  // getAccountStatement (correct split-payment partitioning).
  exports: [CollectionService],
})
export class CollectionModule {}
