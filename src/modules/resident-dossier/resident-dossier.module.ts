import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ResidentDossierController } from './resident-dossier.controller';
import { ResidentDossierService } from './resident-dossier.service';

// RbacService is provided by the @Global RbacModule, so it needs no import here.
@Module({
  imports: [AuditModule],
  controllers: [ResidentDossierController],
  providers: [ResidentDossierService],
})
export class ResidentDossierModule {}
