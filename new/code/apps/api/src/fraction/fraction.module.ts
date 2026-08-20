import { Module } from '@nestjs/common';
import { FractionService } from './fraction.service.js';
import { FractionController } from './fraction.controller.js';

@Module({
  controllers: [FractionController],
  providers: [FractionService],
  exports: [FractionService],
})
export class FractionModule {}
