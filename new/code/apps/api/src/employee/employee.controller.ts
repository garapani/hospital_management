import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { EmployeeService } from './employee.service.js';
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto.js';

@Controller('employees')
@UseGuards(PermissionGuard)
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post()
  @RequirePermission('employee.manage')
  async createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.employeeService.createEmployee(dto);
  }

  @Get()
  @RequirePermission('employee.read')
  async listEmployees(@Query() query: ListEmployeesQueryDto) {
    return this.employeeService.listEmployees(query);
  }

  @Get(':id')
  @RequirePermission('employee.read')
  async getEmployee(@Param('id') id: string) {
    return this.employeeService.getEmployee(id);
  }

  @Patch(':id')
  @RequirePermission('employee.manage')
  async updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeeService.updateEmployee(id, dto);
  }

  @Patch(':id/deactivate')
  @RequirePermission('employee.manage')
  async deactivateEmployee(@Param('id') id: string) {
    return this.employeeService.deactivateEmployee(id);
  }

  @Patch(':id/reactivate')
  @RequirePermission('employee.manage')
  async reactivateEmployee(@Param('id') id: string) {
    return this.employeeService.reactivateEmployee(id);
  }
}
