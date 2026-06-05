import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

// PrismaModule and StorageModule are @Global, so no imports are needed here.
@Module({
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
