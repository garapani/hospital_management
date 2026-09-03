import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PaginationQueryDto } from '@hospital/pagination';
import { CashierShiftService } from './cashier-shift.service.js';
import { OpenShiftDto } from './dto/open-shift.dto.js';
import { CloseShiftDto } from './dto/close-shift.dto.js';

@Controller('billing/cashier-shifts')
@UseGuards(PermissionGuard)
export class CashierShiftController {
  constructor(private readonly cashierShiftService: CashierShiftService) {}

  @Post()
  @RequirePermission('billing.manage')
  async open(@Body() dto: OpenShiftDto) {
    return this.cashierShiftService.openShift(dto);
  }

  @Get('current')
  @RequirePermission('billing.manage')
  async current() {
    return this.cashierShiftService.getCurrentShift();
  }

  @Get()
  @RequirePermission('billing.read')
  async list(@Query() query: PaginationQueryDto) {
    return this.cashierShiftService.list(query);
  }

  @Get(':id')
  @RequirePermission('billing.read')
  async findOne(@Param('id') id: string) {
    return this.cashierShiftService.findOne(id);
  }

  @Get(':id/reconciliation')
  @RequirePermission('billing.read')
  async reconciliation(@Param('id') id: string) {
    return this.cashierShiftService.getReconciliation(id);
  }

  @Post(':id/close')
  @RequirePermission('billing.manage')
  async close(@Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.cashierShiftService.closeShift(id, dto);
  }
}
