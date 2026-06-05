import { Module } from '@nestjs/common';
import { CollectionController } from './collection.controller';
import { CollectionService } from './collection.service';

@Module({
  controllers: [CollectionController],
  providers: [CollectionService],
  // Exported so the resident dossier's ARCO packet (Capa 2E) can reuse
  // getAccountStatement (correct split-payment partitioning).
  exports: [CollectionService],
})
export class CollectionModule {}
