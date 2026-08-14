import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { DepositsService } from './deposits.service.js';
import { CreateDepositDto } from './dto/create-deposit.dto.js';
import { RefundDepositDto } from './dto/refund-deposit.dto.js';
import { ListDepositsDto } from './dto/list-deposits.dto.js';

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
  async list(@Query() query: ListDepositsDto) {
    return this.depositsService.list(query);
  }

  @Patch(':id/refund')
  @RequirePermission('billing.manage')
  async refund(@Param('id') id: string, @Body() dto: RefundDepositDto) {
    return this.depositsService.refund(id, dto);
  }
}
