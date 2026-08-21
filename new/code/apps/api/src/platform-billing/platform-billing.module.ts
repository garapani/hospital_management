import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SubscriptionBillingService } from './subscription-billing.service.js';
import { PlatformBillingController } from './platform-billing.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PlatformBillingController],
  providers: [SubscriptionBillingService],
  exports: [SubscriptionBillingService],
})
export class PlatformBillingModule {}
