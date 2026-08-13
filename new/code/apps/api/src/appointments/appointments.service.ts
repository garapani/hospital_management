import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Appointment } from './entities/appointment.entity.js';
import { Department } from '../master-data/entities/department.entity.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';
import { SearchAppointmentsDto } from './dto/search-appointments.dto.js';

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
      // Check department schedule capacity if departmentId is provided
      if (input.departmentId && input.appointmentDate) {
        const department = await manager.getRepository(Department).findOne({ 
          where: { id: input.departmentId } 
        });
        
        if (department?.maxDailyAppointments) {
          // Count existing appointments for this department on the requested date
          const existingCount = await manager.getRepository(Appointment).count({
            where: {
              departmentId: input.departmentId,
              appointmentDate: input.appointmentDate,
              status: 'Scheduled',
            },
          });
          
          if (existingCount >= department.maxDailyAppointments) {
            throw new ConflictException(
              `Department ${department.departmentName} has reached its maximum daily capacity of ${department.maxDailyAppointments} appointments for ${input.appointmentDate}`
            );
          }
        }
      }
      
      // Check for doctor schedule conflicts if doctorId is provided
      if (input.doctorId && input.appointmentDate && input.appointmentTime) {
        const conflictingAppointment = await manager.getRepository(Appointment).findOne({
          where: {
            doctorId: input.doctorId,
            appointmentDate: input.appointmentDate,
            appointmentTime: input.appointmentTime,
            status: 'Scheduled',
          },
        });
        
        if (conflictingAppointment) {
          throw new ConflictException(
            `Doctor already has an appointment scheduled at ${input.appointmentTime} on ${input.appointmentDate}`
          );
        }
      }
      
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

  async list(query: SearchAppointmentsDto): Promise<PaginatedResponseDto<Appointment>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(Appointment).createQueryBuilder('appointment');
      
      if (query.date) {
        qb.andWhere('appointment.appointmentDate = :date', { date: query.date });
      }
      if (query.doctorId) {
        qb.andWhere('appointment.doctorId = :doctorId', { doctorId: query.doctorId });
      }
      if (query.departmentId) {
        qb.andWhere('appointment.departmentId = :departmentId', { departmentId: query.departmentId });
      }
      if (query.status) {
        qb.andWhere('appointment.status = :status', { status: query.status });
      }
      
      qb.orderBy('appointment.appointmentDate', 'ASC');
      qb.addOrderBy('appointment.appointmentTime', 'ASC');
      
      return paginate(qb, query);
    });
  }
  
  /**
   * Check if a doctor has available slots on a given date
   */
  async getDoctorSchedule(doctorId: string, date: string): Promise<{ available: boolean; bookedSlots: string[]; totalSlots: number }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const appointments = await manager.getRepository(Appointment).find({
        where: {
          doctorId,
          appointmentDate: date,
          status: 'Scheduled',
        },
        order: { appointmentTime: 'ASC' },
      });
      
      const bookedSlots = appointments.map(a => a.appointmentTime);
      
      // Assuming 8-hour workday with 30-minute slots = 16 slots
      const totalSlots = 16;
      
      return {
        available: bookedSlots.length < totalSlots,
        bookedSlots,
        totalSlots,
      };
    });
  }
  
  /**
   * Get department's daily appointment capacity and current bookings
   */
  async getDepartmentSchedule(departmentId: string, date: string): Promise<{ maxCapacity: number | null; currentBookings: number; available: boolean }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const department = await manager.getRepository(Department).findOne({ 
        where: { id: departmentId } 
      });
      
      if (!department) {
        throw new NotFoundException(`Department ${departmentId} not found`);
      }
      
      const currentBookings = await manager.getRepository(Appointment).count({
        where: {
          departmentId,
          appointmentDate: date,
          status: 'Scheduled',
        },
      });
      
      return {
        maxCapacity: department.maxDailyAppointments,
        currentBookings,
        available: !department.maxDailyAppointments || currentBookings < department.maxDailyAppointments,
      };
    });
  }
}
