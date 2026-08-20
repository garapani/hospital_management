import { Module } from '@nestjs/common';
import { VaccinationService } from './vaccination.service.js';
import { VaccinationController } from './vaccination.controller.js';

@Module({
  controllers: [VaccinationController],
  providers: [VaccinationService],
  exports: [VaccinationService],
})
export class VaccinationModule {}
