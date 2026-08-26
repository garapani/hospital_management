import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { CreateStockRequisitionDto } from './dto/create-stock-requisition.dto.js';
import { CancelStockRequisitionDto } from './dto/cancel-stock-requisition.dto.js';
import { SearchStockRequisitionsDto } from './dto/search-stock-requisitions.dto.js';

@Controller('inventory/requisitions')
@UseGuards(PermissionGuard)
export class InventoryRequisitionController {
  constructor(private readonly inventoryRequisitionService: InventoryRequisitionService) {}

  @Post()
  @RequirePermission('inventory.requisition.create')
  async create(@Body() dto: CreateStockRequisitionDto) {
    return this.inventoryRequisitionService.createRequisition(dto);
  }

  @Get()
  @RequirePermission('inventory.read')
  async listByDepartment(@Query() query: SearchStockRequisitionsDto) {
    return this.inventoryRequisitionService.listByDepartment(query);
  }

  @Get(':id')
  @RequirePermission('inventory.read')
  async findOne(@Param('id') id: string) {
    return this.inventoryRequisitionService.findOne(id);
  }

  @Patch(':id/cancel')
  @RequirePermission('inventory.requisition.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelStockRequisitionDto) {
    return this.inventoryRequisitionService.cancel(id, dto.cancelReason);
  }
}
