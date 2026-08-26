import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PatientsService } from './patients.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { SearchPatientsDto } from './dto/search-patients.dto.js';
import { CreatePortalInviteDto } from './dto/create-portal-invite.dto.js';
import { CheckDuplicatesDto } from './dto/check-duplicates.dto.js';

@Controller('patients')
@UseGuards(PermissionGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @RequirePermission('patients.create')
  async create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }

  @Post('check-duplicates')
  @RequirePermission('patients.read')
  async checkDuplicates(@Body() dto: CheckDuplicatesDto) {
    return this.patientsService.checkDuplicates(dto);
  }

  @Get()
  @RequirePermission('patients.read')
  async findAll(@Query() query: SearchPatientsDto) {
    return this.patientsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('patients.read')
  async findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('patients.update')
  async update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patientsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('patients.manage')
  async deactivate(@Param('id') id: string) {
    await this.patientsService.deactivate(id);
    return { success: true };
  }

  @Post(':id/portal-invite')
  @RequirePermission('patients.portal-invite')
  async createPortalInvite(@Param('id') id: string, @Body() dto: CreatePortalInviteDto) {
    const account = await this.patientsService.createPortalInvite(id, dto);
    // initialPassword is disclosed exactly once, in this response — same one-time-disclosure
    // rule as staff account creation. passwordHash never leaves the service layer.
    const { passwordHash: _passwordHash, initialPassword, ...rest } = account;
    return { ...rest, initialPassword };
  }
}
