import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { DepositsService } from './deposits.service.js';
import { CreateDepositDto } from './dto/create-deposit.dto.js';
import { RefundDepositDto } from './dto/refund-deposit.dto.js';

@Controller('billing/deposits')
@UseGuards(PermissionGuard)
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @Post()
  @RequirePermission('billing.manage')
  async create(@Body() dto: CreateDepositDto) {
    return this.depositsService.create(dto);
  }

  @Get()
  @RequirePermission('billing.manage')
  async list(@Query('patientId') patientId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.depositsService.list(patientId, page ? Number(page) : undefined, limit ? Number(limit) : undefined);
  }

  @Patch(':id/refund')
  @RequirePermission('billing.manage')
  async refund(@Param('id') id: string, @Body() dto: RefundDepositDto) {
    return this.depositsService.refund(id, dto);
  }
}
