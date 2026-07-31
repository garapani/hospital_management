import { Module } from '@nestjs/common';
import { TenantContextModule } from '@hospital/tenant-context';
import { AuditSubscriber, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { LoggingAuditEventPublisher } from './logging-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';

@Module({
  imports: [TenantContextModule, DatabaseModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    TenantConnectionService,
    { provide: AUDIT_EVENT_PUBLISHER, useClass: LoggingAuditEventPublisher },
    AuditSubscriber,
    AuditWiringService,
  ],
  exports: [DatabaseModule, AccountsService, TenantConnectionService],
})
export class AccountsModule {}
