import { Module } from '@nestjs/common';
import { FractionService } from './fraction.service.js';
import { FractionController } from './fraction.controller.js';
import { FractionReversalSubscriber } from './fraction-reversal.subscriber.js';

@Module({
  controllers: [FractionController],
  providers: [FractionService, FractionReversalSubscriber],
  exports: [FractionService],
})
export class FractionModule {}
