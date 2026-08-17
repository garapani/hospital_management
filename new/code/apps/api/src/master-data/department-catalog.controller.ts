import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { DepartmentCatalogService } from './department-catalog.service.js';
import { CreateDepartmentCatalogDto } from './dto/create-department-catalog.dto.js';

// TODO: borrowed from master-data.manage during the platform/tenant altitude split
// (2026-08-17) — should eventually get its own permission rather than reusing a
// permission described as "Manage departments and wards".
const REQUIRED_PERMISSION = 'master-data.manage';

@Controller()
@UseGuards(PermissionGuard)
export class DepartmentCatalogController {
  constructor(private readonly departmentCatalogService: DepartmentCatalogService) {}

  @Get('catalogs/departments')
  @RequirePermission(REQUIRED_PERMISSION)
  async listDepartmentCatalogs() {
    return this.departmentCatalogService.listDepartmentCatalogs();
  }

  @Post('catalogs/departments')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async createDepartmentCatalog(@Body() body: CreateDepartmentCatalogDto) {
    return this.departmentCatalogService.createDepartmentCatalog(body);
  }
}
