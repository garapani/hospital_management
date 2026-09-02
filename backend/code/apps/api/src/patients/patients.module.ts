import { Module } from '@nestjs/common';
import { PdfModule } from '@hospital/pdf';
import { DatabaseModule } from '../database/database.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import { PatientsService } from './patients.service.js';
import { PatientsController } from './patients.controller.js';

@Module({
  imports: [DatabaseModule, AccountsModule, PdfModule],
  controllers: [PatientsController],
  providers: [PatientNumberGeneratorService, PatientsService],
  exports: [PatientsService, PatientNumberGeneratorService],
})
export class PatientsModule {}
