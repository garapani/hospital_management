import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PackagesService } from './packages.service.js';

/**
 * Platform catalog of sellable packages, consumed by the platform console's tenant-creation form
 * (choose a package at POST /tenants) and by the package-change dialog
 * (PATCH /tenants/:hospitalId/package).
 */
@Controller('packages')
@UseGuards(PermissionGuard)
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get()
  @RequirePermission('system-admin.tenants.manage')
  async list() {
    return this.packagesService.listPackages();
  }
}
