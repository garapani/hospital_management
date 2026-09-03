import { Module } from '@nestjs/common';
import { PdfModule } from '@hospital/pdf';
import { AccountingModule } from '../accounting/accounting.module.js';
import { BillingSettingsService } from './billing-settings.service.js';
import { BillingSettingsController } from './billing-settings.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoicesController } from './invoices.controller.js';
import { DepositsService } from './deposits.service.js';
import { DepositsController } from './deposits.controller.js';
import { ChargeCaptureSubscriber } from './charge-capture.subscriber.js';
import { InvoiceExportService } from './invoice-export.service.js';
import { CashierShiftService } from './cashier-shift.service.js';
import { CashierShiftController } from './cashier-shift.controller.js';
import { PaymentShiftTagSubscriber } from './payment-shift-tag.subscriber.js';

@Module({
  imports: [AccountingModule, PdfModule],
  controllers: [BillingSettingsController, InvoicesController, DepositsController, CashierShiftController],
  providers: [
    BillingSettingsService,
    InvoicesService,
    DepositsService,
    ChargeCaptureSubscriber,
    InvoiceExportService,
    CashierShiftService,
    PaymentShiftTagSubscriber,
  ],
  exports: [BillingSettingsService, InvoicesService, DepositsService, CashierShiftService],
})
export class BillingModule {}
