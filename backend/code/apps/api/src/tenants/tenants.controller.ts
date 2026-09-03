import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PaginationQueryDto } from '@hospital/pagination';
import { TenantsService } from './tenants.service.js';
import { ProvisionTenantDto } from './dto/provision-tenant.dto.js';
import { SetTenantRolesDto } from './dto/set-tenant-roles.dto.js';
import { SetTenantPackageDto } from './dto/set-tenant-package.dto.js';
import { PurgeTenantDto } from './dto/purge-tenant.dto.js';

const REQUIRED_PERMISSION = 'system-admin.tenants.manage';

@Controller('tenants')
@UseGuards(PermissionGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async provision(@Body() body: ProvisionTenantDto) {
    return this.tenantsService.provisionTenant(body);
  }

  @Get()
  @RequirePermission(REQUIRED_PERMISSION)
  async list(@Query() query: PaginationQueryDto) {
    return this.tenantsService.listTenants(query);
  }

  @Get(':hospitalId')
  @RequirePermission(REQUIRED_PERMISSION)
  async getOne(@Param('hospitalId') hospitalId: string) {
    const tenant = await this.tenantsService.getTenant(hospitalId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    return tenant;
  }

  @Get(':hospitalId/roles')
  @RequirePermission(REQUIRED_PERMISSION)
  async listRoles(@Param('hospitalId') hospitalId: string) {
    return this.tenantsService.listTenantRoles(hospitalId);
  }

  @Patch(':hospitalId/roles')
  @RequirePermission(REQUIRED_PERMISSION)
  async setRoles(
    @Param('hospitalId') hospitalId: string,
    @Body() body: SetTenantRolesDto,
  ) {
    return this.tenantsService.setTenantRoles(hospitalId, body.roleIds);
  }

  @Patch(':hospitalId/package')
  @RequirePermission(REQUIRED_PERMISSION)
  async setPackage(
    @Param('hospitalId') hospitalId: string,
    @Body() body: SetTenantPackageDto,
  ) {
    return this.tenantsService.setTenantPackage(hospitalId, body.packageCode);
  }

  @Patch(':hospitalId/suspend')
  @RequirePermission(REQUIRED_PERMISSION)
  async suspend(@Param('hospitalId') hospitalId: string) {
    return this.tenantsService.suspendTenant(hospitalId);
  }

  @Patch(':hospitalId/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivate(@Param('hospitalId') hospitalId: string) {
    return this.tenantsService.reactivateTenant(hospitalId);
  }

  /** Soft-delete: keeps schema + data, blocks login, reversible. */
  @Patch(':hospitalId/archive')
  @RequirePermission(REQUIRED_PERMISSION)
  async archive(@Param('hospitalId') hospitalId: string) {
    return this.tenantsService.archiveTenant(hospitalId);
  }

  @Patch(':hospitalId/restore')
  @RequirePermission(REQUIRED_PERMISSION)
  async restore(@Param('hospitalId') hospitalId: string) {
    return this.tenantsService.restoreTenant(hospitalId);
  }

  /** Irreversible: drops the tenant schema + role + registry row. Archived tenants only, and the
   *  hospitalId must be confirmed explicitly (typed confirmation in the console). PATCH like the
   *  other tenant actions (the frontend API client has no DELETE-with-body). */
  @Patch(':hospitalId/purge')
  @RequirePermission(REQUIRED_PERMISSION)
  async purge(@Param('hospitalId') hospitalId: string, @Body() body: PurgeTenantDto) {
    return this.tenantsService.purgeTenant(hospitalId, body.confirmHospitalId);
  }
}
