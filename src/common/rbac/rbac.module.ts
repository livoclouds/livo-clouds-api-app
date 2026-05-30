import { Global, Module } from '@nestjs/common';
import { RbacService } from './rbac.service';

// Global so the APP_GUARD PermissionsGuard and any service (Roles/Users) can
// inject RbacService. PrismaModule is already @Global, so no imports needed.
@Global()
@Module({
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
