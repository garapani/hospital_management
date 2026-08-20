import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { WardSupplyService } from './ward-supply.service.js';
import {
  ConsumeStockDto,
  ListBalancesQueryDto,
  ListTransactionsQueryDto,
  ReceiveStockDto,
} from './dto/ward-supply.dto.js';

@Controller('ward-supply')
@UseGuards(PermissionGuard)
export class WardSupplyController {
  constructor(private readonly wardSupplyService: WardSupplyService) {}

  @Post('stock/receive')
  @RequirePermission('ward-supply.manage')
  async receiveStock(@Body() dto: ReceiveStockDto) {
    return this.wardSupplyService.receiveStock(dto.departmentId, dto.itemId, dto.quantity, dto);
  }

  @Post('stock/consume')
  @RequirePermission('ward-supply.manage')
  async consumeStock(@Body() dto: ConsumeStockDto) {
    return this.wardSupplyService.consumeStock(dto.departmentId, dto.itemId, dto.quantity, dto);
  }

  @Get('stock')
  @RequirePermission('ward-supply.read')
  async listBalances(@Query() query: ListBalancesQueryDto) {
    return this.wardSupplyService.listBalances(query);
  }

  @Get('transactions')
  @RequirePermission('ward-supply.read')
  async listTransactions(@Query() query: ListTransactionsQueryDto) {
    return this.wardSupplyService.listTransactions(query);
  }
}
