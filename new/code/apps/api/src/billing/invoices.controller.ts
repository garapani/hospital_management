import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { RecordPaymentDto } from './dto/record-payment.dto.js';
import { CreateReturnDto } from './dto/create-return.dto.js';

export class ListInvoicesQueryDto {
  patientId?: string;
  status?: string;
  sourceAdmissionId?: string;
  sourceAppointmentId?: string;
  page?: number;
  limit?: number;
}

@Controller('billing/invoices')
@UseGuards(PermissionGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequirePermission('billing.manage')
  async create(@Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(dto);
  }

  @Get()
  @RequirePermission('billing.manage')
  async list(@Query() query: ListInvoicesQueryDto) {
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
