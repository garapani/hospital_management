import { Module } from '@nestjs/common';
import { OtService } from './ot.service.js';
import { OtController } from './ot.controller.js';
import { OtSurgeryNumberGeneratorService } from './ot-surgery-number-generator.service.js';

@Module({
  controllers: [OtController],
  providers: [OtService, OtSurgeryNumberGeneratorService],
  exports: [OtService],
})
export class OtModule {}
