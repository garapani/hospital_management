import { Module } from '@nestjs/common';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { ReportingSubscriber } from './reporting.subscriber.js';
import { TenantContextModule } from '@hospital/tenant-context';

@Module({
  imports: [TenantContextModule],
  providers: [PersistingReportingEventPublisher, ReportingSubscriber],
  exports: [PersistingReportingEventPublisher],
})
export class ReportingModule {}
