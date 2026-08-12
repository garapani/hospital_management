import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { AdmissionsService } from './admissions.service.js';
import { CreateAdmissionDto } from './dto/create-admission.dto.js';
import { TransferAdmissionDto } from './dto/transfer-admission.dto.js';
import { DischargeAdmissionDto } from './dto/discharge-admission.dto.js';

export class ListAdmissionsQueryDto {
  wardId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@Controller('admissions')
@UseGuards(PermissionGuard)
export class AdmissionsController {
  constructor(private readonly admissionsService: AdmissionsService) {}

  @Post()
  @RequirePermission('admission.manage')
  async admit(@Body() dto: CreateAdmissionDto) {
    return this.admissionsService.admit(dto);
  }

  @Get()
  @RequirePermission('admission.read')
  async list(@Query() query: ListAdmissionsQueryDto) {
    return this.admissionsService.listActive(query);
  }

  @Get(':id')
  @RequirePermission('admission.read')
  async findOne(@Param('id') id: string) {
    return this.admissionsService.findOne(id);
  }

  @Patch(':id/transfer')
  @RequirePermission('admission.manage')
  async transfer(@Param('id') id: string, @Body() dto: TransferAdmissionDto) {
    return this.admissionsService.transfer(id, dto);
  }

  @Patch(':id/discharge')
  @RequirePermission('admission.manage')
  async discharge(@Param('id') id: string, @Body() dto: DischargeAdmissionDto) {
    return this.admissionsService.discharge(id, dto);
  }
}
