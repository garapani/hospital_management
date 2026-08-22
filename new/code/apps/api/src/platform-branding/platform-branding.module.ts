import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { ObjectStorageModule } from '@hospital/object-storage';
import { PlatformBrandingService } from './platform-branding.service.js';
import { PlatformBrandingController } from './platform-branding.controller.js';
import { TenantBrandingController } from './tenant-branding.controller.js';

@Module({
  imports: [DatabaseModule, TenantsModule, ObjectStorageModule],
  controllers: [PlatformBrandingController, TenantBrandingController],
  providers: [PlatformBrandingService],
})
export class PlatformBrandingModule {}
