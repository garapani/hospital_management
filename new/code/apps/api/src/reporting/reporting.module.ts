import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { ReportingSubscriber } from './reporting.subscriber.js';
import { TenantContextModule } from '../tenant-context/tenant-context.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([ReportingEvent]), TenantContextModule],
  providers: [PersistingReportingEventPublisher, ReportingSubscriber],
  exports: [PersistingReportingEventPublisher],
})
export class ReportingModule {}
