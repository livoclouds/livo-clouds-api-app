import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ResidentDossierModule } from '../resident-dossier/resident-dossier.module';
import { CondominiumArcoController } from './condominium-arco.controller';
import { ResidentArcoController } from './resident-arco.controller';
import { ResidentArcoService } from './resident-arco.service';
import { ArcoDeadlineCron } from './arco-deadline.cron';
import { ArcoRetentionService } from './arco-retention.service';

// RbacService + StorageService are provided by their @Global modules.
// ResidentDossierModule is imported so an ACCESS request can reuse the existing
// ARCO subject packet (exportArcoPacket). EmailModule powers resident-facing
// transparency notices; NotificationsModule powers the in-app admin overdue
// alert. ArcoDeadlineCron + ArcoRetentionService host the @Cron sweeps.
@Module({
  imports: [AuditModule, ResidentDossierModule, EmailModule, NotificationsModule],
  controllers: [ResidentArcoController, CondominiumArcoController],
  providers: [ResidentArcoService, ArcoDeadlineCron, ArcoRetentionService],
})
export class ResidentArcoModule {}
