import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CollectionModule } from '../collection/collection.module';
import { ResidentsController } from './residents.controller';
import { ResidentsService } from './residents.service';

@Module({
  // CollectionModule provides CollectionService for the composite profile
  // endpoint (RP-026): account statement + financial-health in one call.
  imports: [AuditModule, CollectionModule],
  controllers: [ResidentsController],
  providers: [ResidentsService],
  exports: [ResidentsService],
})
export class ResidentsModule {}
