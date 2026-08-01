import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';

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
  async list(@Query('patientId') patientId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.invoicesService.list(patientId, page ? Number(page) : undefined, limit ? Number(limit) : undefined);
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
}
