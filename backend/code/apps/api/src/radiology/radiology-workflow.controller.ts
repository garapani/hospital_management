import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { RadiologyWorkflowService } from './radiology-workflow.service.js';
import { CreateRadiologyRequisitionDto } from './dto/create-radiology-requisition.dto.js';
import { MarkScannedDto } from './dto/mark-scanned.dto.js';
import { EnterReportDto } from './dto/enter-report.dto.js';
import { VerifyRadiologyRequisitionDto } from './dto/verify-radiology-requisition.dto.js';
import { CancelRadiologyRequisitionDto } from './dto/cancel-radiology-requisition.dto.js';
import { ListRadiologyRequisitionDto } from './dto/list-radiology-requisition.dto.js';

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
  async findAll(@Query() query: ListRadiologyRequisitionDto) {
    return this.radiologyWorkflowService.findAll(query);
  }

  /** PDF export of a Verified requisition's report. Must precede `@Get(':id')` so the literal
   *  `report.pdf` segment isn't captured as an id. */
  @Get(':id/report.pdf')
  @RequirePermission('radiology.read')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename="radiology-report.pdf"')
  async reportPdf(@Param('id') id: string): Promise<StreamableFile> {
    const buffer = await this.radiologyWorkflowService.renderReportPdf(id);
    return new StreamableFile(buffer);
  }

  /** Requisition label for film envelopes/paperwork. Same precede-`:id` reasoning as report.pdf. */
  @Get(':id/requisition-label.pdf')
  @RequirePermission('radiology.read')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename="radiology-requisition-label.pdf"')
  async requisitionLabelPdf(@Param('id') id: string): Promise<StreamableFile> {
    const buffer = await this.radiologyWorkflowService.renderRequisitionLabelPdf(id);
    return new StreamableFile(buffer);
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
