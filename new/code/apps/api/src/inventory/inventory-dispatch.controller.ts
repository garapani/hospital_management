import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { FulfillRequisitionItemDto } from './dto/fulfill-requisition-item.dto.js';

@Controller('inventory/requisitions')
@UseGuards(PermissionGuard)
export class InventoryDispatchController {
  constructor(private readonly inventoryRequisitionService: InventoryRequisitionService) {}

  @Post('items/:stockRequisitionItemId/fulfill')
  @RequirePermission('inventory.dispatch.fulfill')
  async fulfill(
    @Param('stockRequisitionItemId') stockRequisitionItemId: string,
    @Body() dto: FulfillRequisitionItemDto,
  ) {
    return this.inventoryRequisitionService.fulfillRequisitionItem(stockRequisitionItemId, dto);
  }
}
