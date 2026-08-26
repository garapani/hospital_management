import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import { RecordGoodsReceiptDto } from './dto/record-goods-receipt.dto.js';
import { CancelPurchaseOrderDto } from './dto/cancel-purchase-order.dto.js';
import { SearchPurchaseOrdersDto } from './dto/search-purchase-orders.dto.js';
import { SearchStockBalancesDto } from './dto/search-stock-balances.dto.js';

@Controller('inventory/purchase-orders')
@UseGuards(PermissionGuard)
export class InventoryProcurementController {
  constructor(private readonly inventoryProcurementService: InventoryProcurementService) {}

  @Post()
  @RequirePermission('inventory.purchase-order.create')
  async create(@Body() dto: CreatePurchaseOrderDto) {
    return this.inventoryProcurementService.createPurchaseOrder(dto);
  }

  @Get()
  @RequirePermission('inventory.read')
  async listByVendor(@Query() query: SearchPurchaseOrdersDto) {
    return this.inventoryProcurementService.listByVendor(query);
  }

  @Get('stock-balances')
  @RequirePermission('inventory.read')
  async listStockBalances(@Query() query: SearchStockBalancesDto) {
    return this.inventoryProcurementService.listStockBalances(query);
  }

  @Get('stock-balances/low-stock')
  @RequirePermission('inventory.read')
  async listLowStockItems() {
    return this.inventoryProcurementService.listLowStockItems();
  }

  @Get(':id')
  @RequirePermission('inventory.read')
  async findOne(@Param('id') id: string) {
    return this.inventoryProcurementService.findOne(id);
  }

  @Patch(':id/cancel')
  @RequirePermission('inventory.purchase-order.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelPurchaseOrderDto) {
    return this.inventoryProcurementService.cancel(id, dto.cancelReason);
  }

  @Post('items/:purchaseOrderItemId/goods-receipt')
  @RequirePermission('inventory.goods-receipt.enter')
  async recordGoodsReceipt(
    @Param('purchaseOrderItemId') purchaseOrderItemId: string,
    @Body() dto: RecordGoodsReceiptDto,
  ) {
    return this.inventoryProcurementService.recordGoodsReceipt(purchaseOrderItemId, dto);
  }
}
