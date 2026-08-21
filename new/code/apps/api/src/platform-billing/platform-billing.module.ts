import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PackagesModule } from '../packages/packages.module.js';
import { SubscriptionBillingService } from './subscription-billing.service.js';
import { PlatformBillingController } from './platform-billing.controller.js';

@Module({
  imports: [DatabaseModule, PackagesModule],
  controllers: [PlatformBillingController],
  providers: [SubscriptionBillingService],
  exports: [SubscriptionBillingService],
})
export class PlatformBillingModule {}
