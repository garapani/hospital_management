import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { ReportingSubscriber } from './reporting.subscriber.js';
import { TenantContextModule } from '@hospital/tenant-context';
import {
  REPORTING_DATA_SOURCE,
  createReportingDataSource,
} from '../database/reporting-data-source.js';

@Module({
  imports: [TenantContextModule],
  providers: [
    {
      // Dedicated, bounded connection pool for reporting-archive writes — see
      // `createReportingDataSource()` for why it must not share the main pool.
      provide: REPORTING_DATA_SOURCE,
      useFactory: async () => {
        const ds = createReportingDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
    PersistingReportingEventPublisher,
    ReportingSubscriber,
  ],
  exports: [PersistingReportingEventPublisher],
})
export class ReportingModule implements OnModuleDestroy {
  constructor(@Inject(REPORTING_DATA_SOURCE) private readonly reportingDataSource: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    if (this.reportingDataSource.isInitialized) {
      await this.reportingDataSource.destroy();
    }
  }
}
