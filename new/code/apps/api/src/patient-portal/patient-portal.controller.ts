import { Controller, Get, UseGuards } from '@nestjs/common';
import { PatientAuthGuard } from '@hospital/auth-guards';
import { PatientPortalService } from './patient-portal.service.js';

@Controller('patient-portal')
@UseGuards(PatientAuthGuard)
export class PatientPortalController {
  constructor(private readonly patientPortalService: PatientPortalService) {}

  @Get('me')
  async getMe() {
    return this.patientPortalService.getMe();
  }

  @Get('appointments')
  async listAppointments() {
    return this.patientPortalService.listAppointments();
  }

  @Get('invoices')
  async listInvoices() {
    return this.patientPortalService.listInvoices();
  }

  @Get('prescriptions')
  async listPrescriptions() {
    return this.patientPortalService.listPrescriptions();
  }

  @Get('results')
  async listResults() {
    return this.patientPortalService.listResults();
  }
}
