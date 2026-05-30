import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';

// PrismaModule and RbacModule are @Global, so only AuditModule needs importing.
@Module({
  imports: [AuditModule],
  controllers: [PlatformUsersController],
  providers: [PlatformUsersService],
})
export class PlatformUsersModule {}
