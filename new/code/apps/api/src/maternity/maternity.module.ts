import { Module } from '@nestjs/common';
import { MaternityService } from './maternity.service.js';
import { MaternityController } from './maternity.controller.js';

@Module({
  controllers: [MaternityController],
  providers: [MaternityService],
  exports: [MaternityService],
})
export class MaternityModule {}
