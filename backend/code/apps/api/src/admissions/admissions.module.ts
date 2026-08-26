import { Module } from '@nestjs/common';
import { AdmissionsService } from './admissions.service.js';
import { AdmissionsController } from './admissions.controller.js';

@Module({
  controllers: [AdmissionsController],
  providers: [AdmissionsService],
  exports: [AdmissionsService],
})
export class AdmissionsModule {}
