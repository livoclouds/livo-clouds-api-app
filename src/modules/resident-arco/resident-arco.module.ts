import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ResidentDossierModule } from '../resident-dossier/resident-dossier.module';
import { ResidentArcoController } from './resident-arco.controller';
import { ResidentArcoService } from './resident-arco.service';

// RbacService + StorageService are provided by their @Global modules.
// ResidentDossierModule is imported so an ACCESS request can reuse the existing
// ARCO subject packet (exportArcoPacket).
@Module({
  imports: [AuditModule, ResidentDossierModule],
  controllers: [ResidentArcoController],
  providers: [ResidentArcoService],
})
export class ResidentArcoModule {}
