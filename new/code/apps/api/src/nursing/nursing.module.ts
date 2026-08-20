import { Module } from '@nestjs/common';
import { NursingService } from './nursing.service.js';
import { NursingController } from './nursing.controller.js';

@Module({
  controllers: [NursingController],
  providers: [NursingService],
  exports: [NursingService],
})
export class NursingModule {}
