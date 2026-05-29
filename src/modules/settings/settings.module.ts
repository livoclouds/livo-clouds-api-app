import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingsCacheService } from './settings-cache.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SettingsCacheService],
  exports: [SettingsService, SettingsCacheService],
})
export class SettingsModule {}
