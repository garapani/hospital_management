import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PaginationQueryDto } from '@hospital/pagination';
import { VitalsService } from './vitals.service.js';
import { CreateVitalDto } from './dto/create-vital.dto.js';
import { UpdateVitalDto } from './dto/update-vital.dto.js';

@Controller('vitals')
@UseGuards(PermissionGuard)
export class VitalsController {
  constructor(private readonly vitalsService: VitalsService) {}

  @Post()
  @RequirePermission('vitals.manage')
  async create(@Body() dto: CreateVitalDto) {
    return this.vitalsService.create(dto);
  }

  @Get('patient/:patientId')
  @RequirePermission('vitals.read')
  async listByPatient(
    @Param('patientId') patientId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.vitalsService.listByPatient(patientId, query);
  }

  @Get(':id')
  @RequirePermission('vitals.read')
  async findOne(@Param('id') id: string) {
    return this.vitalsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('vitals.manage')
  async update(@Param('id') id: string, @Body() dto: UpdateVitalDto) {
    return this.vitalsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('vitals.manage')
  async voidVital(@Param('id') id: string) {
    await this.vitalsService.void(id);
    return { success: true };
  }
}
