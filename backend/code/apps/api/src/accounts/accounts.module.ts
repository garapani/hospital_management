import { Module } from '@nestjs/common';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

@Module({
  imports: [TenantContextModule, DatabaseModule, AuditModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [DatabaseModule, AccountsService],
})
export class AccountsModule {}
