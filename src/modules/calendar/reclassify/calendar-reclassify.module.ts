import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { ClassificationModule } from '../../classification/classification.module';
import { CalendarReclassifyService } from './calendar-reclassify.service';

@Module({
  // AuditModule (CAL-039): engine-triggered reclassify runs write an audit row.
  imports: [ClassificationModule, AuditModule],
  providers: [CalendarReclassifyService],
  exports: [CalendarReclassifyService],
})
export class CalendarReclassifyModule {}
