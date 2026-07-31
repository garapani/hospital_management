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
import { MasterDataService } from './master-data.service.js';
import { CreateDepartmentDto } from './dto/create-department.dto.js';
import { CreateWardDto } from './dto/create-ward.dto.js';

const REQUIRED_PERMISSION = 'master-data.manage';

@Controller()
@UseGuards(PermissionGuard)
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Post('departments')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async createDepartment(@Body() body: CreateDepartmentDto) {
    return this.masterDataService.createDepartment(body);
  }

  @Get('departments')
  @RequirePermission(REQUIRED_PERMISSION)
  async listDepartments() {
    return this.masterDataService.listDepartments();
  }

  @Get('departments/:id')
  @RequirePermission(REQUIRED_PERMISSION)
  async getDepartment(@Param('id') id: string) {
    const department = await this.masterDataService.getDepartment(id);
    if (!department) {
      throw new NotFoundException(`Department ${id} not found`);
    }
    return department;
  }

  @Patch('departments/:id/deactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async deactivateDepartment(@Param('id') id: string) {
    return this.masterDataService.deactivateDepartment(id);
  }

  @Patch('departments/:id/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivateDepartment(@Param('id') id: string) {
    return this.masterDataService.reactivateDepartment(id);
  }

  @Post('wards')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async createWard(@Body() body: CreateWardDto) {
    return this.masterDataService.createWard(body);
  }

  @Get('wards')
  @RequirePermission(REQUIRED_PERMISSION)
  async listWards() {
    return this.masterDataService.listWards();
  }

  @Get('wards/:id')
  @RequirePermission(REQUIRED_PERMISSION)
  async getWard(@Param('id') id: string) {
    const ward = await this.masterDataService.getWard(id);
    if (!ward) {
      throw new NotFoundException(`Ward ${id} not found`);
    }
    return ward;
  }

  @Patch('wards/:id/deactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async deactivateWard(@Param('id') id: string) {
    return this.masterDataService.deactivateWard(id);
  }

  @Patch('wards/:id/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivateWard(@Param('id') id: string) {
    return this.masterDataService.reactivateWard(id);
  }
}
