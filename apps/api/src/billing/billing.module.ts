import { Module } from '@nestjs/common';
import { BillingSettingsService } from './billing-settings.service.js';
import { BillingSettingsController } from './billing-settings.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoicesController } from './invoices.controller.js';
import { DepositsService } from './deposits.service.js';
import { DepositsController } from './deposits.controller.js';
import { LabBillingAdapter } from './adapters/lab-billing.adapter.js';
import { RadiologyBillingAdapter } from './adapters/radiology-billing.adapter.js';
import { PharmacyBillingAdapter } from './adapters/pharmacy-billing.adapter.js';

@Module({
  controllers: [BillingSettingsController, InvoicesController, DepositsController],
  providers: [
    BillingSettingsService,
    InvoicesService,
    DepositsService,
    {
      provide: 'LAB_BILLING_ADAPTER',
      useClass: LabBillingAdapter,
    },
    {
      provide: 'RADIOLOGY_BILLING_ADAPTER',
      useClass: RadiologyBillingAdapter,
    },
    {
      provide: 'PHARMACY_BILLING_ADAPTER',
      useClass: PharmacyBillingAdapter,
    },
  ],
  exports: [BillingSettingsService, InvoicesService, DepositsService],
})
export class BillingModule {}
