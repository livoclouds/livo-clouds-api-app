import { Module } from '@nestjs/common';
import { ClassificationModule } from '../classification/classification.module';
import { SettingsModule } from '../settings/settings.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [ClassificationModule, SettingsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
