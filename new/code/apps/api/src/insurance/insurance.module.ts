import { Module } from '@nestjs/common';
import { InsuranceClaimsService } from './insurance-claims.service.js';
import { InsuranceController } from './insurance.controller.js';
import { InsuranceClaimNumberGeneratorService } from './insurance-claim-number-generator.service.js';

@Module({
  controllers: [InsuranceController],
  providers: [InsuranceClaimsService, InsuranceClaimNumberGeneratorService],
  exports: [InsuranceClaimsService],
})
export class InsuranceModule {}
