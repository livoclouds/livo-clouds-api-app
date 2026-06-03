import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PettyCashController } from './petty-cash.controller';
import { PettyCashService } from './petty-cash.service';

@Module({
  imports: [SettingsModule],
  controllers: [PettyCashController],
  providers: [PettyCashService],
})
export class PettyCashModule {}
