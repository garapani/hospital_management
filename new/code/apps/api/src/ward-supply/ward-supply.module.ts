import { Module } from '@nestjs/common';
import { WardSupplyService } from './ward-supply.service.js';
import { WardSupplyController } from './ward-supply.controller.js';

@Module({
  controllers: [WardSupplyController],
  providers: [WardSupplyService],
  exports: [WardSupplyService],
})
export class WardSupplyModule {}
