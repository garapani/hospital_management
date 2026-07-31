import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Appointment } from './entities/appointment.entity.js';

export interface CreateAppointmentInput {
  patientId?: string;
  firstName: string;
  lastName: string;
  contactNumber: string;
  appointmentDate: string;
  appointmentTime: string;
  doctorId?: string;
  departmentId?: string;
  appointmentType: string;
  reason?: string;
}

export interface UpdateAppointmentInput {
  patientId?: string;
  firstName?: string;
  lastName?: string;
  contactNumber?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  doctorId?: string;
  departmentId?: string;
  appointmentType?: string;
  status?: string;
  reason?: string;
}

export interface AppointmentFilters {
  date?: string;
  doctorId?: string;
  departmentId?: string;
  status?: string;
}

@Injectable()
export class AppointmentsService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async create(input: CreateAppointmentInput): Promise<Appointment> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repo = manager.getRepository(Appointment);
      const appointment = repo.create({
        ...input,
        status: 'Scheduled',
      });
      return repo.save(appointment);
    });
  }

  async getById(id: string): Promise<Appointment> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const appointment = await manager.getRepository(Appointment).findOne({ where: { id } });
      if (!appointment) {
        throw new NotFoundException(`Appointment ${id} not found`);
      }
      return appointment;
    });
  }

  async update(id: string, input: UpdateAppointmentInput): Promise<Appointment> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repo = manager.getRepository(Appointment);
      const appointment = await repo.findOne({ where: { id } });
      if (!appointment) {
        throw new NotFoundException(`Appointment ${id} not found`);
      }
      Object.assign(appointment, input);
      return repo.save(appointment);
    });
  }

  async cancel(id: string, cancelledRemarks: string): Promise<Appointment> {
    if (!cancelledRemarks || cancelledRemarks.trim() === '') {
      throw new BadRequestException('cancelledRemarks is required');
    }
    
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repo = manager.getRepository(Appointment);
      const appointment = await repo.findOne({ where: { id } });
      if (!appointment) {
        throw new NotFoundException(`Appointment ${id} not found`);
      }
      appointment.status = 'Cancelled';
      appointment.cancelledRemarks = cancelledRemarks;
      return repo.save(appointment);
    });
  }

  async list(filters: AppointmentFilters): Promise<Appointment[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(Appointment).createQueryBuilder('appointment');
      
      if (filters.date) {
        qb.andWhere('appointment.appointmentDate = :date', { date: filters.date });
      }
      if (filters.doctorId) {
        qb.andWhere('appointment.doctorId = :doctorId', { doctorId: filters.doctorId });
      }
      if (filters.departmentId) {
        qb.andWhere('appointment.departmentId = :departmentId', { departmentId: filters.departmentId });
      }
      if (filters.status) {
        qb.andWhere('appointment.status = :status', { status: filters.status });
      }
      
      qb.orderBy('appointment.appointmentDate', 'ASC');
      qb.addOrderBy('appointment.appointmentTime', 'ASC');
      
      return qb.getMany();
    });
  }
}
