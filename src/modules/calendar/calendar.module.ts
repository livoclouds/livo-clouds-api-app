import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

// CAL-011: ReconciliationModule provides the guarded reopenTransaction used when an
// operator chooses to reopen the approved payment of a cancelled terrace booking.
// The dependency is one-way (reconciliation never imports calendar), so no cycle.
@Module({
  imports: [AuditModule, ReconciliationModule],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
