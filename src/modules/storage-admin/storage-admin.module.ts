import { Module } from '@nestjs/common';
import { StorageAdminController } from './storage-admin.controller';
import { StorageAdminService } from './storage-admin.service';

@Module({
  controllers: [StorageAdminController],
  providers: [StorageAdminService],
})
export class StorageAdminModule {}
