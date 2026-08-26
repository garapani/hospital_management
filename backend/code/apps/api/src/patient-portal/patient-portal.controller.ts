import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { PatientAuthGuard } from '@hospital/auth-guards';
import { PaginationQueryDto } from '@hospital/pagination';
import { PatientPortalService } from './patient-portal.service.js';

// Cache-Control: no-store on every endpoint here — this whole controller serves PHI to the
// patient's own browser; a shared or disk cache holding a stale copy after logout (or on a
// shared device) is the exact exposure this header exists to prevent.
@Controller('patient-portal')
@UseGuards(PatientAuthGuard)
export class PatientPortalController {
  constructor(private readonly patientPortalService: PatientPortalService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async getMe() {
    return this.patientPortalService.getMe();
  }

  @Get('appointments')
  @Header('Cache-Control', 'no-store')
  async listAppointments(@Query() query: PaginationQueryDto) {
    return this.patientPortalService.listAppointments(query);
  }

  @Get('invoices')
  @Header('Cache-Control', 'no-store')
  async listInvoices(@Query() query: PaginationQueryDto) {
    return this.patientPortalService.listInvoices(query);
  }

  @Get('prescriptions')
  @Header('Cache-Control', 'no-store')
  async listPrescriptions(@Query() query: PaginationQueryDto) {
    return this.patientPortalService.listPrescriptions(query);
  }

  @Get('results')
  @Header('Cache-Control', 'no-store')
  async listResults(@Query() query: PaginationQueryDto) {
    return this.patientPortalService.listResults(query);
  }
}
