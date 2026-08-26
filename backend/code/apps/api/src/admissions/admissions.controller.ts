import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { AdmissionsService } from './admissions.service.js';
import { CreateAdmissionDto } from './dto/create-admission.dto.js';
import { TransferAdmissionDto } from './dto/transfer-admission.dto.js';
import { DischargeAdmissionDto } from './dto/discharge-admission.dto.js';
import { CreateDischargeSummaryDto, UpdateDischargeSummaryDto, ReviewDischargeSummaryDto } from './dto/discharge-summary.dto.js';
import { SearchAdmissionsDto } from './dto/search-admissions.dto.js';

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
  async list(@Query() query: SearchAdmissionsDto) {
    return this.admissionsService.list(query);
  }

  @Get('active')
  @RequirePermission('admission.read')
  async listActive(@Query('wardId', new ParseUUIDPipe({ optional: true })) wardId?: string) {
    return this.admissionsService.listActive(wardId);
  }

  @Post('discharge-summaries')
  @RequirePermission('admission.manage')
  async createDischargeSummary(@Body() dto: CreateDischargeSummaryDto) {
    return this.admissionsService.createDischargeSummary({
      ...dto,
      followUpAppointmentDate: dto.followUpAppointmentDate ? new Date(dto.followUpAppointmentDate) : undefined,
    });
  }

  @Get('discharge-summaries')
  @RequirePermission('admission.read')
  async listDischargeSummaries(@Query('patientId', new ParseUUIDPipe({ optional: true })) patientId?: string) {
    return this.admissionsService.listDischargeSummaries(patientId);
  }

  @Get('discharge-summaries/by-admission/:admissionId')
  @RequirePermission('admission.read')
  async getDischargeSummaryByAdmission(@Param('admissionId') admissionId: string) {
    return this.admissionsService.getDischargeSummaryByAdmission(admissionId);
  }

  @Get('discharge-summaries/:id')
  @RequirePermission('admission.read')
  async getDischargeSummary(@Param('id') id: string) {
    return this.admissionsService.getDischargeSummary(id);
  }

  @Patch('discharge-summaries/:id')
  @RequirePermission('admission.manage')
  async updateDischargeSummary(@Param('id') id: string, @Body() dto: UpdateDischargeSummaryDto) {
    return this.admissionsService.updateDischargeSummary(id, {
      ...dto,
      followUpAppointmentDate: dto.followUpAppointmentDate ? new Date(dto.followUpAppointmentDate) : undefined,
    });
  }

  @Patch('discharge-summaries/:id/review')
  @RequirePermission('admission.manage')
  async reviewDischargeSummary(@Param('id') id: string, @Body() dto: ReviewDischargeSummaryDto) {
    return this.admissionsService.reviewDischargeSummary(id, dto.reviewedBy);
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
