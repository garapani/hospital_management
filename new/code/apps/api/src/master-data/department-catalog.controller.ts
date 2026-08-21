import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { DepartmentCatalogService } from './department-catalog.service.js';
import { CreateDepartmentCatalogDto } from './dto/create-department-catalog.dto.js';
import { UpdateDepartmentCatalogDto } from './dto/update-department-catalog.dto.js';

// Platform-only, same as the role catalog: the Global Catalog screen (departments tab) lives in
// the platform console. rbac.manage is mapped to the Super Admin role only (seed-rbac-catalog.ts),
// so hospital admins can never create/edit the shared department templates.
const REQUIRED_PERMISSION = 'rbac.manage';

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

  @Patch('catalogs/departments/:id')
  @RequirePermission(REQUIRED_PERMISSION)
  async updateDepartmentCatalog(@Param('id') id: string, @Body() body: UpdateDepartmentCatalogDto) {
    return this.departmentCatalogService.updateDepartmentCatalog(id, body);
  }

  @Patch('catalogs/departments/:id/deactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async deactivateDepartmentCatalog(@Param('id') id: string) {
    return this.departmentCatalogService.deactivateDepartmentCatalog(id);
  }

  @Patch('catalogs/departments/:id/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivateDepartmentCatalog(@Param('id') id: string) {
    return this.departmentCatalogService.reactivateDepartmentCatalog(id);
  }
}
