import { Module } from '@nestjs/common';
import { InsuranceClaimsService } from './insurance-claims.service.js';
import { InsuranceController } from './insurance.controller.js';
import { InsuranceClaimNumberGeneratorService } from './insurance-claim-number-generator.service.js';
import { BillingModule } from '../billing/billing.module.js';

@Module({
  imports: [BillingModule],
  controllers: [InsuranceController],
  providers: [InsuranceClaimsService, InsuranceClaimNumberGeneratorService],
  exports: [InsuranceClaimsService],
})
export class InsuranceModule {}
