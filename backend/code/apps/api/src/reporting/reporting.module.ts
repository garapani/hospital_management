import { Module } from '@nestjs/common';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { ReportingSubscriber } from './reporting.subscriber.js';
import { ReportingQueryService } from './reporting-query.service.js';
import { ReportingController } from './reporting.controller.js';
import { TenantContextModule } from '@hospital/tenant-context';
import { PdfModule } from '@hospital/pdf';
import { ExcelModule } from '@hospital/excel';
import { DatabaseModule } from '../database/database.module.js';

@Module({
  imports: [TenantContextModule, DatabaseModule, PdfModule, ExcelModule],
  controllers: [ReportingController],
  providers: [PersistingReportingEventPublisher, ReportingSubscriber, ReportingQueryService],
  exports: [PersistingReportingEventPublisher],
})
export class ReportingModule {}
