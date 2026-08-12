import { Global, Module } from '@nestjs/common';
import { AuditSubscriber, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';

@Global()
@Module({
  imports: [TenantContextModule, DatabaseModule],
  controllers: [AuditController],
  providers: [
    { provide: AUDIT_EVENT_PUBLISHER, useClass: PersistingAuditEventPublisher },
    AuditSubscriber,
    AuditWiringService,
    AuditService,
  ],
  exports: [AUDIT_EVENT_PUBLISHER, AuditSubscriber, AuditService],
})
export class AuditModule {}

