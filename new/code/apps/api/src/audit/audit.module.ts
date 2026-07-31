import { Global, Module } from '@nestjs/common';
import { AuditSubscriber, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';

@Global()
@Module({
  imports: [TenantContextModule, DatabaseModule],
  providers: [
    { provide: AUDIT_EVENT_PUBLISHER, useClass: PersistingAuditEventPublisher },
    AuditSubscriber,
    AuditWiringService,
  ],
  exports: [AUDIT_EVENT_PUBLISHER, AuditSubscriber],
})
export class AuditModule {}
