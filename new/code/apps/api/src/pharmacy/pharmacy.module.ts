import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PharmacyDispensingService } from './pharmacy-dispensing.service.js';
import { PharmacyDispensingController } from './pharmacy-dispensing.controller.js';
import { PharmacyDispensingNumberGeneratorService } from './pharmacy-dispensing-number-generator.service.js';
import { BillingModule } from '../billing/billing.module.js';

@Module({
  imports: [InventoryModule, BillingModule],
  controllers: [PharmacyDispensingController],
  providers: [PharmacyDispensingService, PharmacyDispensingNumberGeneratorService],
  exports: [PharmacyDispensingService],
})
export class PharmacyModule {}
