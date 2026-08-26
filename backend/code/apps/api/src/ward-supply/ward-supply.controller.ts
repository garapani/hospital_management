import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { WardSupplyService } from './ward-supply.service.js';
import {
  AdjustStockDto,
  ConsumeStockDto,
  ListBalancesQueryDto,
  ListTransactionsQueryDto,
  ReceiveStockDto,
  ReturnStockDto,
  WasteStockDto,
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

  @Post('stock/return')
  @RequirePermission('ward-supply.manage')
  async returnStock(@Body() dto: ReturnStockDto) {
    return this.wardSupplyService.returnStock(dto.departmentId, dto.itemId, dto.quantity, dto);
  }

  @Post('stock/waste')
  @RequirePermission('ward-supply.manage')
  async wasteStock(@Body() dto: WasteStockDto) {
    return this.wardSupplyService.wasteStock(dto.departmentId, dto.itemId, dto.quantity, dto);
  }

  @Post('stock/adjust')
  @RequirePermission('ward-supply.manage')
  async adjustStock(@Body() dto: AdjustStockDto) {
    return this.wardSupplyService.adjustStock(dto.departmentId, dto.itemId, dto.delta, dto);
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
