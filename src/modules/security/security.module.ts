import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

@Module({
  imports: [AuditModule],
  controllers: [SecurityController],
  providers: [SecurityService],
})
export class SecurityModule {}
