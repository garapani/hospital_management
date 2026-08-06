import { Module } from '@nestjs/common';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { InventoryCatalogController } from './inventory-catalog.controller.js';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { InventoryProcurementController } from './inventory-procurement.controller.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';

@Module({
  controllers: [InventoryCatalogController, InventoryProcurementController],
  providers: [InventoryCatalogService, InventoryProcurementService, PurchaseOrderNumberGeneratorService],
  exports: [InventoryCatalogService, InventoryProcurementService],
})
export class InventoryModule {}
