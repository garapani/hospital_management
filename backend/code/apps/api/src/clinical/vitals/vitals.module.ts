import { Module } from '@nestjs/common';
import { VitalsService } from './vitals.service.js';
import { VitalsController } from './vitals.controller.js';

@Module({
  controllers: [VitalsController],
  providers: [VitalsService],
  exports: [VitalsService],
})
export class VitalsModule {}
