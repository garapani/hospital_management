import { Controller, Get, Post, Put, Body, Param, Query, HttpCode, HttpStatus, UseGuards, BadRequestException } from '@nestjs/common';
import { RequirePermission, PermissionGuard } from '@hospital/auth-guards';
import { AppointmentsService } from './appointments.service.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { UpdateAppointmentDto } from './dto/update-appointment.dto.js';
import { SearchAppointmentsDto } from './dto/search-appointments.dto.js';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto.js';

@Controller('appointments')
@UseGuards(PermissionGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @RequirePermission('appointment.manage')
  async createAppointment(@Body() body: CreateAppointmentDto) {
    return this.appointmentsService.create(body);
  }

  @Get()
  @RequirePermission('appointment.read')
  async listAppointments(@Query() query: SearchAppointmentsDto) {
    return this.appointmentsService.list(query);
  }

  @Get(':id')
  @RequirePermission('appointment.read')
  async getAppointment(@Param('id') id: string) {
    return this.appointmentsService.getById(id);
  }

  @Put(':id')
  @RequirePermission('appointment.manage')
  async updateAppointment(@Param('id') id: string, @Body() body: UpdateAppointmentDto) {
    return this.appointmentsService.update(id, body);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('appointment.manage')
  async checkInAppointment(@Param('id') id: string) {
    return this.appointmentsService.checkIn(id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('appointment.manage')
  async completeAppointment(@Param('id') id: string) {
    return this.appointmentsService.complete(id);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('appointment.manage')
  async markAppointmentNoShow(@Param('id') id: string) {
    return this.appointmentsService.markNoShow(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('appointment.manage')
  async cancelAppointment(@Param('id') id: string, @Body() body: CancelAppointmentDto) {
    return this.appointmentsService.cancel(id, body.cancelledRemarks);
  }

  @Get('doctors/:doctorId/schedule')
  @RequirePermission('appointment.read')
  async getDoctorSchedule(@Param('doctorId') doctorId: string, @Query('date') date: string) {
    if (!date) {
      throw new BadRequestException('date query parameter is required');
    }
    return this.appointmentsService.getDoctorSchedule(doctorId, date);
  }

  @Get('departments/:departmentId/schedule')
  @RequirePermission('appointment.read')
  async getDepartmentSchedule(@Param('departmentId') departmentId: string, @Query('date') date: string) {
    if (!date) {
      throw new BadRequestException('date query parameter is required');
    }
    return this.appointmentsService.getDepartmentSchedule(departmentId, date);
  }
}
