import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { InventoryCatalogController } from './inventory-catalog.controller.js';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { InventoryProcurementController } from './inventory-procurement.controller.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { InventoryRequisitionController } from './inventory-requisition.controller.js';
import { InventoryDispatchController } from './inventory-dispatch.controller.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';
import { FefoStockDecrementService } from './fefo-stock-decrement.service.js';

@Module({
  imports: [MasterDataModule],
  controllers: [
    InventoryCatalogController,
    InventoryProcurementController,
    InventoryRequisitionController,
    InventoryDispatchController,
  ],
  providers: [
    InventoryCatalogService,
    InventoryProcurementService,
    PurchaseOrderNumberGeneratorService,
    InventoryRequisitionService,
    StockRequisitionNumberGeneratorService,
    FefoStockDecrementService,
  ],
  exports: [InventoryCatalogService, InventoryProcurementService, InventoryRequisitionService, FefoStockDecrementService],
})
export class InventoryModule {}
