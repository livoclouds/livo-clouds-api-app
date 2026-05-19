import { Module } from '@nestjs/common';
import { BankProfilesController } from './bank-profiles.controller';
import { BankProfilesService } from './bank-profiles.service';

@Module({
  controllers: [BankProfilesController],
  providers: [BankProfilesService],
  exports: [BankProfilesService],
})
export class BankProfilesModule {}
