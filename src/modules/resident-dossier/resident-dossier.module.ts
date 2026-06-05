import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ResidentDossierController } from './resident-dossier.controller';
import { ResidentDossierService } from './resident-dossier.service';
import { DossierRetentionService } from './resident-dossier-retention.service';

// RbacService + StorageService are provided by their @Global modules, so they
// need no import here. DossierRetentionService hosts the daily @Cron sweep.
@Module({
  imports: [AuditModule],
  controllers: [ResidentDossierController],
  providers: [ResidentDossierService, DossierRetentionService],
})
export class ResidentDossierModule {}
