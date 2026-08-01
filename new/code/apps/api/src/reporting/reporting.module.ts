import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';

@Module({
  imports: [TypeOrmModule.forFeature([ReportingEvent])],
  providers: [PersistingReportingEventPublisher],
  exports: [PersistingReportingEventPublisher],
})
export class ReportingModule {}
