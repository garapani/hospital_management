import { Module } from '@nestjs/common';
import { BillingSettingsService } from './billing-settings.service.js';
import { BillingSettingsController } from './billing-settings.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoicesController } from './invoices.controller.js';

@Module({
  controllers: [BillingSettingsController, InvoicesController],
  providers: [BillingSettingsService, InvoicesService],
  exports: [BillingSettingsService, InvoicesService],
})
export class BillingModule {}
