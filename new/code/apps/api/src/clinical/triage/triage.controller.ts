import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { TriageService } from './triage.service.js';
import { CreateTriageEntryDto } from './dto/create-triage-entry.dto.js';
import { UpdateTriageEntryDto } from './dto/update-triage-entry.dto.js';
import { LinkPatientDto } from './dto/link-patient.dto.js';

@Controller('triage/entries')
@UseGuards(PermissionGuard)
export class TriageController {
  constructor(private readonly triageService: TriageService) {}

  @Post()
  @RequirePermission('triage.manage')
  async create(@Body() dto: CreateTriageEntryDto) {
    return this.triageService.create(dto);
  }

  @Get()
  @RequirePermission('triage.read')
  async list() {
    return this.triageService.listActive();
  }

  @Get(':id')
  @RequirePermission('triage.read')
  async findOne(@Param('id') id: string) {
    return this.triageService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('triage.manage')
  async update(@Param('id') id: string, @Body() dto: UpdateTriageEntryDto) {
    return this.triageService.update(id, dto);
  }

  @Patch(':id/link-patient')
  @RequirePermission('triage.manage')
  async linkPatient(@Param('id') id: string, @Body() dto: LinkPatientDto) {
    return this.triageService.linkPatient(id, dto.patientId);
  }
}
