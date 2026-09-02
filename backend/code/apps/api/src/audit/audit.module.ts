import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditSubscriber, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { AUDIT_DATA_SOURCE, createAuditDataSource } from '../database/audit-data-source.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';

@Global()
@Module({
  imports: [TenantContextModule, DatabaseModule],
  controllers: [AuditController],
  providers: [
    {
      // Dedicated, bounded connection pool for audit writes — see `createAuditDataSource()` for
      // why it must not share the main pool.
      provide: AUDIT_DATA_SOURCE,
      useFactory: async () => {
        const ds = createAuditDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
    { provide: AUDIT_EVENT_PUBLISHER, useClass: PersistingAuditEventPublisher },
    AuditSubscriber,
    AuditWiringService,
    AuditService,
  ],
  exports: [AUDIT_EVENT_PUBLISHER, AuditSubscriber, AuditService],
})
export class AuditModule implements OnModuleDestroy {
  constructor(@Inject(AUDIT_DATA_SOURCE) private readonly auditDataSource: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    if (this.auditDataSource.isInitialized) {
      await this.auditDataSource.destroy();
    }
  }
}

