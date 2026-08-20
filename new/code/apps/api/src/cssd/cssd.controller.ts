import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PaginationQueryDto } from '@hospital/pagination';
import { CssdService } from './cssd.service.js';
import {
  CompleteCycleDto,
  CreateInstrumentDto,
  FailCycleDto,
  ListCyclesQueryDto,
  StartCycleDto,
  UpdateInstrumentDto,
} from './dto/cssd.dto.js';

@Controller('cssd')
@UseGuards(PermissionGuard)
export class CssdController {
  constructor(private readonly cssdService: CssdService) {}

  // Instruments
  @Post('instruments')
  @RequirePermission('cssd.manage')
  async createInstrument(@Body() dto: CreateInstrumentDto) {
    return this.cssdService.createInstrument(dto);
  }

  @Get('instruments')
  @RequirePermission('cssd.read')
  async listInstruments() {
    return this.cssdService.listInstruments();
  }

  @Patch('instruments/:id')
  @RequirePermission('cssd.manage')
  async updateInstrument(@Param('id') id: string, @Body() dto: UpdateInstrumentDto) {
    return this.cssdService.updateInstrument(id, dto);
  }

  @Patch('instruments/:id/deactivate')
  @RequirePermission('cssd.manage')
  async deactivateInstrument(@Param('id') id: string) {
    return this.cssdService.deactivateInstrument(id);
  }

  @Patch('instruments/:id/reactivate')
  @RequirePermission('cssd.manage')
  async reactivateInstrument(@Param('id') id: string) {
    return this.cssdService.reactivateInstrument(id);
  }

  // Sterilization cycles
  @Post('cycles')
  @RequirePermission('cssd.manage')
  async startCycle(@Body() dto: StartCycleDto) {
    return this.cssdService.startCycle(dto);
  }

  @Get('cycles')
  @RequirePermission('cssd.read')
  async listCycles(@Query() query: PaginationQueryDto & ListCyclesQueryDto) {
    return this.cssdService.listCycles(query);
  }

  @Get('cycles/:id')
  @RequirePermission('cssd.read')
  async getCycle(@Param('id') id: string) {
    return this.cssdService.getCycle(id);
  }

  @Post('cycles/:id/complete')
  @RequirePermission('cssd.manage')
  async completeCycle(@Param('id') id: string, @Body() dto: CompleteCycleDto) {
    return this.cssdService.completeCycle(id, dto);
  }

  @Post('cycles/:id/fail')
  @RequirePermission('cssd.manage')
  async failCycle(@Param('id') id: string, @Body() dto: FailCycleDto) {
    return this.cssdService.failCycle(id, dto);
  }
}
