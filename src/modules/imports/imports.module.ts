import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClassificationModule } from '../classification/classification.module';
import { SettingsModule } from '../settings/settings.module';
import { BankProfilesModule } from '../bank-profiles/bank-profiles.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportsMaintenanceCron } from './imports-maintenance.cron';
import { ImportsParserService } from './parser';

@Module({
  imports: [AuditModule, ClassificationModule, SettingsModule, BankProfilesModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsMaintenanceCron, ImportsParserService],
})
export class ImportsModule {}
