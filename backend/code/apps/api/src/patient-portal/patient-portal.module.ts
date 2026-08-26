import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PatientPortalService } from './patient-portal.service.js';
import { PatientPortalController } from './patient-portal.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PatientPortalController],
  providers: [PatientPortalService],
})
export class PatientPortalModule {}
