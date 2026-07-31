import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextModule } from '@hospital/tenant-context';
import { AuditSubscriber, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { createDataSource } from '../database/data-source.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { LoggingAuditEventPublisher } from './logging-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';

@Module({
  imports: [TenantContextModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    TenantConnectionService,
    {
      provide: DataSource,
      useFactory: async () => {
        const ds = createDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
    { provide: AUDIT_EVENT_PUBLISHER, useClass: LoggingAuditEventPublisher },
    AuditSubscriber,
    AuditWiringService,
  ],
  exports: [AccountsService, DataSource, TenantConnectionService],
})
export class AccountsModule {}
