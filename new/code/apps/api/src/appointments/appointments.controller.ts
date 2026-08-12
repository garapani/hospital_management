import { Controller, Get, Post, Put, Body, Param, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { RequirePermission, PermissionGuard } from '@hospital/auth-guards';
import { AppointmentsService } from './appointments.service.js';
import type { CreateAppointmentInput, UpdateAppointmentInput, AppointmentFilters } from './appointments.service.js';

export class ListAppointmentsQueryDto {
  date?: string;
  doctorId?: string;
  departmentId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@Controller('appointments')
@UseGuards(PermissionGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @RequirePermission('appointment.manage')
  async createAppointment(@Body() body: CreateAppointmentInput) {
    return this.appointmentsService.create(body);
  }

  @Get()
  @RequirePermission('appointment.read')
  async listAppointments(@Query() query: ListAppointmentsQueryDto) {
    const filters: AppointmentFilters = query;
    return this.appointmentsService.list(filters);
  }

  @Get(':id')
  @RequirePermission('appointment.read')
  async getAppointment(@Param('id') id: string) {
    return this.appointmentsService.getById(id);
  }

  @Put(':id')
  @RequirePermission('appointment.manage')
  async updateAppointment(@Param('id') id: string, @Body() body: UpdateAppointmentInput) {
    return this.appointmentsService.update(id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('appointment.manage')
  async cancelAppointment(@Param('id') id: string, @Body() body: { cancelledRemarks: string }) {
    return this.appointmentsService.cancel(id, body.cancelledRemarks);
  }

  @Get('doctors/:doctorId/schedule')
  @RequirePermission('appointment.read')
  async getDoctorSchedule(
    @Param('doctorId') doctorId: string,
    @Query('date') date: string,
  ) {
    if (!date) {
      throw new Error('date query parameter is required');
    }
    return this.appointmentsService.getDoctorSchedule(doctorId, date);
  }

  @Get('departments/:departmentId/schedule')
  @RequirePermission('appointment.read')
  async getDepartmentSchedule(
    @Param('departmentId') departmentId: string,
    @Query('date') date: string,
  ) {
    if (!date) {
      throw new Error('date query parameter is required');
    }
    return this.appointmentsService.getDepartmentSchedule(departmentId, date);
  }
}
