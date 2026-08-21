import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { RecordPaymentDto } from './dto/record-payment.dto.js';
import { CreateReturnDto } from './dto/create-return.dto.js';
import { ListInvoicesDto } from './dto/list-invoices.dto.js';
import { ReRunChargeCaptureDto } from './dto/re-run-charge-capture.dto.js';

@Controller('billing/invoices')
@UseGuards(PermissionGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequirePermission('billing.manage')
  async create(@Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(dto);
  }

  /** Recovery path: re-attempt charge capture for a completed order item whose automatic
   *  capture was skipped (e.g. it was unpriced at completion time) or failed. */
  @Post('charge-capture')
  @RequirePermission('billing.manage')
  async reRunChargeCapture(@Body() dto: ReRunChargeCaptureDto) {
    return this.invoicesService.reRunChargeCapture(dto.orderItemId);
  }

  @Get()
  @RequirePermission('billing.manage')
  async list(@Query() query: ListInvoicesDto) {
    return this.invoicesService.list(query);
  }

  @Get(':id')
  @RequirePermission('billing.manage')
  async findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(id);
  }

  @Patch(':id/cancel')
  @RequirePermission('billing.manage')
  async cancel(@Param('id') id: string) {
    return this.invoicesService.cancel(id);
  }

  @Post(':id/payments')
  @RequirePermission('billing.manage')
  async recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto) {
    return this.invoicesService.recordPayment(id, dto);
  }

  @Post(':id/returns')
  @RequirePermission('billing.manage')
  async createReturn(@Param('id') id: string, @Body() dto: CreateReturnDto) {
    return this.invoicesService.createReturn(id, dto);
  }
}
