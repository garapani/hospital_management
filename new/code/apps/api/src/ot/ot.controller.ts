import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { OtService } from './ot.service.js';
import { CancelSurgeryDto } from './dto/cancel-surgery.dto.js';
import { CompleteSurgeryDto } from './dto/complete-surgery.dto.js';
import { CreateSurgeryDto } from './dto/create-surgery.dto.js';
import { ListSurgeriesQueryDto } from './dto/list-surgeries.dto.js';

@Controller('ot')
@UseGuards(PermissionGuard)
export class OtController {
  constructor(private readonly otService: OtService) {}

  @Post('surgeries')
  @RequirePermission('ot.manage')
  async scheduleSurgery(@Body() dto: CreateSurgeryDto) {
    return this.otService.scheduleSurgery(dto);
  }

  @Get('surgeries')
  @RequirePermission('ot.read')
  async listSurgeries(@Query() query: ListSurgeriesQueryDto) {
    return this.otService.listSurgeries(query);
  }

  @Get('surgeries/:id')
  @RequirePermission('ot.read')
  async getSurgery(@Param('id') id: string) {
    return this.otService.getSurgery(id);
  }

  @Post('surgeries/:id/start')
  @RequirePermission('ot.manage')
  async startSurgery(@Param('id') id: string) {
    return this.otService.startSurgery(id);
  }

  @Post('surgeries/:id/complete')
  @RequirePermission('ot.manage')
  async completeSurgery(@Param('id') id: string, @Body() dto: CompleteSurgeryDto) {
    return this.otService.completeSurgery(id, undefined, dto.postOpNotes);
  }

  @Post('surgeries/:id/cancel')
  @RequirePermission('ot.manage')
  async cancelSurgery(@Param('id') id: string, @Body() dto: CancelSurgeryDto) {
    return this.otService.cancelSurgery(id, undefined, dto.reason);
  }
}
