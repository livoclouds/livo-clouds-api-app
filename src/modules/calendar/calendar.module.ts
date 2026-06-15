import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SettingsModule } from '../settings/settings.module';
import { CalendarController } from './calendar.controller';
import { CalendarMaintenanceCron } from './calendar-maintenance.cron';
import { CalendarService } from './calendar.service';

// CAL-011: ReconciliationModule provides the guarded reopenTransaction used when an
// operator chooses to reopen the approved payment of a cancelled terrace booking.
// The dependency is one-way (reconciliation never imports calendar), so no cycle.
// CAL-043: CalendarMaintenanceCron runs daily (stale-PENDING expiry + soft-delete
// purge); ScheduleModule is registered globally in app.module.ts.
// CAL-064: SettingsModule provides the tenant-scoped SettingsCacheService the cron
// reads to resolve each condominium's PENDING hold window (one-way; settings never
// imports calendar, so no cycle).
@Module({
  imports: [AuditModule, ReconciliationModule, SettingsModule],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarMaintenanceCron],
  exports: [CalendarService],
})
export class CalendarModule {}
