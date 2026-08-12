import { Module } from '@nestjs/common';
import { BillingSettingsService } from './billing-settings.service.js';
import { BillingSettingsController } from './billing-settings.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoicesController } from './invoices.controller.js';
import { DepositsService } from './deposits.service.js';
import { DepositsController } from './deposits.controller.js';
import { LabModule } from '../lab/lab.module.js';
import { RadiologyModule } from '../radiology/radiology.module.js';
import { PharmacyModule } from '../pharmacy/pharmacy.module.js';

@Module({
  controllers: [BillingSettingsController, InvoicesController, DepositsController],
  providers: [BillingSettingsService, InvoicesService, DepositsService],
  exports: [BillingSettingsService, InvoicesService, DepositsService],
  imports: [LabModule, RadiologyModule, PharmacyModule],
})
export class BillingModule {}
