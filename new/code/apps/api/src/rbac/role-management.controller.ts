import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { RoleManagementService } from './role-management.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';

// TODO: borrowed from master-data.manage during the platform/tenant altitude split
// (2026-08-17) — should eventually get its own permission (e.g. rbac.manage) rather
// than reusing a permission described as "Manage departments and wards".
const REQUIRED_PERMISSION = 'master-data.manage';

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
