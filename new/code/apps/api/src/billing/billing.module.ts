import { Module } from '@nestjs/common';
import { BillingSettingsService } from './billing-settings.service.js';
import { BillingSettingsController } from './billing-settings.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoicesController } from './invoices.controller.js';
import { DepositsService } from './deposits.service.js';
import { DepositsController } from './deposits.controller.js';
import { ChargeCaptureSubscriber } from './charge-capture.subscriber.js';

@Module({
  controllers: [BillingSettingsController, InvoicesController, DepositsController],
  providers: [BillingSettingsService, InvoicesService, DepositsService, ChargeCaptureSubscriber],
  exports: [BillingSettingsService, InvoicesService, DepositsService],
})
export class BillingModule {}
