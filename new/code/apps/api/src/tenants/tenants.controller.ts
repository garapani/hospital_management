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
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { TenantsService } from './tenants.service.js';
import { ProvisionTenantDto } from './dto/provision-tenant.dto.js';

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
  async list() {
    return this.tenantsService.listTenants();
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
}
