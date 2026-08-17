import { Module } from '@nestjs/common';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { MasterDataController } from './master-data.controller.js';
import { MasterDataService } from './master-data.service.js';
import { DepartmentCatalogController } from './department-catalog.controller.js';
import { DepartmentCatalogService } from './department-catalog.service.js';

@Module({
  imports: [TenantContextModule, DatabaseModule],
  controllers: [MasterDataController, DepartmentCatalogController],
  providers: [MasterDataService, DepartmentCatalogService],
  exports: [MasterDataService],
})
export class MasterDataModule {}
