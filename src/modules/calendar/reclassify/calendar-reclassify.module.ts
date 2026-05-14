import { Module } from '@nestjs/common';
import { ClassificationModule } from '../../classification/classification.module';
import { CalendarReclassifyService } from './calendar-reclassify.service';

@Module({
  imports: [ClassificationModule],
  providers: [CalendarReclassifyService],
  exports: [CalendarReclassifyService],
})
export class CalendarReclassifyModule {}
