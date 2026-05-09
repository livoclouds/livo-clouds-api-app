import { Module } from '@nestjs/common';
import { PettyCashController } from './petty-cash.controller';
import { PettyCashService } from './petty-cash.service';

@Module({
  controllers: [PettyCashController],
  providers: [PettyCashService],
})
export class PettyCashModule {}
