import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { RadiologyWorkflowService } from './radiology-workflow.service.js';
import { CreateRadiologyRequisitionDto } from './dto/create-radiology-requisition.dto.js';
import { MarkScannedDto } from './dto/mark-scanned.dto.js';
import { EnterReportDto } from './dto/enter-report.dto.js';
import { VerifyRadiologyRequisitionDto } from './dto/verify-radiology-requisition.dto.js';
import { CancelRadiologyRequisitionDto } from './dto/cancel-radiology-requisition.dto.js';

@Controller('radiology/requisitions')
@UseGuards(PermissionGuard)
export class RadiologyWorkflowController {
  constructor(private readonly radiologyWorkflowService: RadiologyWorkflowService) {}

  @Post()
  @RequirePermission('radiology.requisition.create')
  async create(@Body() dto: CreateRadiologyRequisitionDto) {
    return this.radiologyWorkflowService.createRequisition(dto);
  }

  @Get()
  @RequirePermission('radiology.read')
  async listByOrderItem(@Query('orderItemId') orderItemId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.radiologyWorkflowService.listByOrderItem({ orderItemId, page: pageNum, limit: limitNum });
  }

  @Get(':id')
  @RequirePermission('radiology.read')
  async findOne(@Param('id') id: string) {
    return this.radiologyWorkflowService.findOne(id);
  }

  @Patch(':id/mark-scanned')
  @RequirePermission('radiology.report.enter')
  async markScanned(@Param('id') id: string, @Body() dto: MarkScannedDto) {
    return this.radiologyWorkflowService.markScanned(id, dto.scannedBy);
  }

  @Post(':id/report')
  @RequirePermission('radiology.report.enter')
  async enterReport(@Param('id') id: string, @Body() dto: EnterReportDto) {
    return this.radiologyWorkflowService.enterReport(id, dto);
  }

  @Patch(':id/verify')
  @RequirePermission('radiology.report.verify')
  async verify(@Param('id') id: string, @Body() dto: VerifyRadiologyRequisitionDto) {
    return this.radiologyWorkflowService.verify(id, dto.verifiedBy);
  }

  @Patch(':id/cancel')
  @RequirePermission('radiology.requisition.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelRadiologyRequisitionDto) {
    return this.radiologyWorkflowService.cancel(id, dto.cancelReason);
  }
}
