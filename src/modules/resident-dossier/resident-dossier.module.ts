import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CollectionModule } from '../collection/collection.module';
import { ResidentDossierController } from './resident-dossier.controller';
import { ResidentDossierService } from './resident-dossier.service';
import { DossierRetentionService } from './resident-dossier-retention.service';

// RbacService + StorageService are provided by their @Global modules, so they
// need no import here. DossierRetentionService hosts the daily @Cron sweep.
// CollectionModule is imported so the ARCO packet (Capa 2E) reuses
// getAccountStatement for the resident's financial summary.
@Module({
  imports: [AuditModule, CollectionModule],
  controllers: [ResidentDossierController],
  providers: [ResidentDossierService, DossierRetentionService],
})
export class ResidentDossierModule {}
