import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PharmacyDispensingService } from './pharmacy-dispensing.service.js';
import { PharmacyDispensingController } from './pharmacy-dispensing.controller.js';
import { PharmacyDispensingNumberGeneratorService } from './pharmacy-dispensing-number-generator.service.js';
import { PharmacyOrderCancellationSubscriber } from './pharmacy-order-cancellation.subscriber.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [InventoryModule, OrdersModule],
  controllers: [PharmacyDispensingController],
  providers: [
    PharmacyDispensingService,
    PharmacyDispensingNumberGeneratorService,
    PharmacyOrderCancellationSubscriber,
  ],
  exports: [PharmacyDispensingService],
})
export class PharmacyModule {}
