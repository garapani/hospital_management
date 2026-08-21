import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { RoleManagementService } from './role-management.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';

// Platform-only by design: the global role catalog is a super-admin concern (the Global Catalog
// screen lives in the platform console). Hospital admins map roles to users via the
// tenant-scoped /accounts/roles endpoints — they must never create or list catalog roles.
// rbac.manage is mapped to the Super Admin role only (see seed-rbac-catalog.ts).
const REQUIRED_PERMISSION = 'rbac.manage';

@Controller()
@UseGuards(PermissionGuard)
export class RoleManagementController {
  constructor(private readonly roleManagementService: RoleManagementService) {}

  @Get('roles')
  @RequirePermission(REQUIRED_PERMISSION)
  async listRoles() {
    return this.roleManagementService.listRoles();
  }

  @Post('roles')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async createRole(@Body() body: CreateRoleDto) {
    return this.roleManagementService.createRole(body);
  }
}
