import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClassificationModule } from '../classification/classification.module';
import { SettingsModule } from '../settings/settings.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportsParserService } from './parser';

@Module({
  imports: [AuditModule, ClassificationModule, SettingsModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsParserService],
})
export class ImportsModule {}
