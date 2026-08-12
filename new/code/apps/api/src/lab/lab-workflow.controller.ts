import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { LabWorkflowService } from './lab-workflow.service.js';
import { CreateRequisitionDto } from './dto/create-requisition.dto.js';
import { CollectSampleDto } from './dto/collect-sample.dto.js';
import { EnterResultDto } from './dto/enter-result.dto.js';
import { VerifyRequisitionDto } from './dto/verify-requisition.dto.js';
import { CancelRequisitionDto } from './dto/cancel-requisition.dto.js';
import { SearchLabRequisitionsDto } from './dto/search-lab-requisitions.dto.js';

@Controller('lab/requisitions')
@UseGuards(PermissionGuard)
export class LabWorkflowController {
  constructor(private readonly labWorkflowService: LabWorkflowService) {}

  @Post()
  @RequirePermission('lab.requisition.create')
  async create(@Body() dto: CreateRequisitionDto) {
    return this.labWorkflowService.createRequisition(dto);
  }

  @Get()
  @RequirePermission('lab.read')
  async listByOrderItem(@Query() query: SearchLabRequisitionsDto) {
    return this.labWorkflowService.listByOrderItem(query);
  }

  @Get(':id')
  @RequirePermission('lab.read')
  async findOne(@Param('id') id: string) {
    return this.labWorkflowService.findOne(id);
  }

  @Patch(':id/collect-sample')
  @RequirePermission('lab.result.enter')
  async collectSample(@Param('id') id: string, @Body() dto: CollectSampleDto) {
    return this.labWorkflowService.collectSample(id, dto.sampleCollectedBy);
  }

  @Post(':id/results')
  @RequirePermission('lab.result.enter')
  async enterResult(@Param('id') id: string, @Body() dto: EnterResultDto) {
    return this.labWorkflowService.enterResult(id, dto);
  }

  @Patch(':id/verify')
  @RequirePermission('lab.result.verify')
  async verify(@Param('id') id: string, @Body() dto: VerifyRequisitionDto) {
    return this.labWorkflowService.verify(id, dto.verifiedBy);
  }

  @Patch(':id/cancel')
  @RequirePermission('lab.requisition.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelRequisitionDto) {
    return this.labWorkflowService.cancel(id, dto.cancelReason);
  }
}
