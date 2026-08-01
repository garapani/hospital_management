import { Module } from '@nestjs/common';
import { BillingSettingsService } from './billing-settings.service.js';
import { BillingSettingsController } from './billing-settings.controller.js';

@Module({
  controllers: [BillingSettingsController],
  providers: [BillingSettingsService],
  exports: [BillingSettingsService],
})
export class BillingModule {}
