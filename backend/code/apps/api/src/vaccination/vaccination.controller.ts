import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { VaccinationService } from './vaccination.service.js';
import { CreateVaccinationRecordDto } from './dto/create-vaccination-record.dto.js';
import { ListVaccinationRecordsQueryDto } from './dto/list-vaccination-records.dto.js';

@Controller('vaccination')
@UseGuards(PermissionGuard)
export class VaccinationController {
  constructor(private readonly vaccinationService: VaccinationService) {}

  @Post('records')
  @RequirePermission('vaccination.manage')
  async record(@Body() dto: CreateVaccinationRecordDto) {
    return this.vaccinationService.record(dto);
  }

  @Get('records')
  @RequirePermission('vaccination.read')
  async listRecords(@Query() query: ListVaccinationRecordsQueryDto) {
    return this.vaccinationService.listRecords(query);
  }

  @Get('records/:id')
  @RequirePermission('vaccination.read')
  async getRecord(@Param('id') id: string) {
    return this.vaccinationService.getRecord(id);
  }
}
