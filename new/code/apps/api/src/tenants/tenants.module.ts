import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantProvisioningService],
  exports: [TenantsService],
})
export class TenantsModule {}
