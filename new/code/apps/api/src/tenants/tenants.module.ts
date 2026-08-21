import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PackagesModule } from '../packages/packages.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';

@Module({
  imports: [DatabaseModule, PackagesModule, AccountsModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantProvisioningService],
  exports: [TenantsService],
})
export class TenantsModule {}
