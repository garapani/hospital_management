import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { In, Not, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Appointment } from './entities/appointment.entity.js';
import { Department } from '../master-data/entities/department.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
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
  reason?: string;
}

// Statuses that still occupy a doctor/department slot — excludes Cancelled and NoShow, which
// free it up. Used everywhere a query needs "does this appointment still hold its slot", not
// just the literal 'Scheduled' status, so checking a patient in doesn't silently let a second
// appointment get double-booked into the same slot.
const ACTIVE_APPOINTMENT_STATUSES = ['Scheduled', 'CheckedIn', 'Completed'] as const;

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
      if (input.patientId) {
        const patient = await manager.getRepository(Patient).findOne({ where: { id: input.patientId } });
        if (!patient) {
          throw new NotFoundException(`Patient ${input.patientId} not found`);
        }
      }

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
              status: In(ACTIVE_APPOINTMENT_STATUSES),
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
            status: In(ACTIVE_APPOINTMENT_STATUSES),
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
      try {
        return await repo.save(appointment);
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_appointments_active_doctor_slot'
        ) {
          throw new ConflictException(
            `Doctor already has an appointment scheduled at ${input.appointmentTime} on ${input.appointmentDate}`,
          );
        }
        throw error;
      }
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
      if (appointment.status === 'Cancelled') {
        throw new ConflictException(`Appointment ${id} is cancelled and cannot be updated`);
      }
      if (input.patientId) {
        const patient = await manager.getRepository(Patient).findOne({ where: { id: input.patientId } });
        if (!patient) {
          throw new NotFoundException(`Patient ${input.patientId} not found`);
        }
      }

      const isReschedule =
        input.appointmentDate !== undefined ||
        input.appointmentTime !== undefined ||
        input.doctorId !== undefined ||
        input.departmentId !== undefined;

      if (isReschedule) {
        const nextDate = input.appointmentDate ?? appointment.appointmentDate;
        const nextTime = input.appointmentTime ?? appointment.appointmentTime;
        const nextDoctorId = input.doctorId ?? appointment.doctorId;
        const nextDepartmentId = input.departmentId ?? appointment.departmentId;

        if (nextDepartmentId && nextDate) {
          const department = await manager.getRepository(Department).findOne({
            where: { id: nextDepartmentId },
          });

          if (department?.maxDailyAppointments) {
            const existingCount = await manager.getRepository(Appointment).count({
              where: {
                departmentId: nextDepartmentId,
                appointmentDate: nextDate,
                status: In(ACTIVE_APPOINTMENT_STATUSES),
                id: Not(id),
              },
            });

            if (existingCount >= department.maxDailyAppointments) {
              throw new ConflictException(
                `Department ${department.departmentName} has reached its maximum daily capacity of ${department.maxDailyAppointments} appointments for ${nextDate}`,
              );
            }
          }
        }

        if (nextDoctorId && nextDate && nextTime) {
          const conflictingAppointment = await manager.getRepository(Appointment).findOne({
            where: {
              doctorId: nextDoctorId,
              appointmentDate: nextDate,
              appointmentTime: nextTime,
              status: In(ACTIVE_APPOINTMENT_STATUSES),
              id: Not(id),
            },
          });

          if (conflictingAppointment) {
            throw new ConflictException(
              `Doctor already has an appointment scheduled at ${nextTime} on ${nextDate}`,
            );
          }
        }
      }

      Object.assign(appointment, input);
      try {
        return await repo.save(appointment);
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_appointments_active_doctor_slot'
        ) {
          throw new ConflictException(
            `Doctor already has an appointment scheduled at ${appointment.appointmentTime} on ${appointment.appointmentDate}`,
          );
        }
        throw error;
      }
    });
  }

  async checkIn(id: string): Promise<Appointment> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repo = manager.getRepository(Appointment);
      const appointment = await repo.findOne({ where: { id } });
      if (!appointment) {
        throw new NotFoundException(`Appointment ${id} not found`);
      }
      if (appointment.status !== 'Scheduled') {
        throw new ConflictException(`Appointment ${id} is ${appointment.status} and cannot be checked in`);
      }
      appointment.status = 'CheckedIn';
      return repo.save(appointment);
    });
  }

  async complete(id: string): Promise<Appointment> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repo = manager.getRepository(Appointment);
      const appointment = await repo.findOne({ where: { id } });
      if (!appointment) {
        throw new NotFoundException(`Appointment ${id} not found`);
      }
      if (appointment.status !== 'Scheduled' && appointment.status !== 'CheckedIn') {
        throw new ConflictException(`Appointment ${id} is ${appointment.status} and cannot be completed`);
      }
      appointment.status = 'Completed';
      return repo.save(appointment);
    });
  }

  async markNoShow(id: string): Promise<Appointment> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repo = manager.getRepository(Appointment);
      const appointment = await repo.findOne({ where: { id } });
      if (!appointment) {
        throw new NotFoundException(`Appointment ${id} not found`);
      }
      if (appointment.status !== 'Scheduled' && appointment.status !== 'CheckedIn') {
        throw new ConflictException(`Appointment ${id} is ${appointment.status} and cannot be marked as a no-show`);
      }
      appointment.status = 'NoShow';
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
      if (appointment.status === 'Cancelled') {
        throw new ConflictException(`Appointment ${id} is already cancelled`);
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
      if (query.patientId) {
        qb.andWhere('appointment.patientId = :patientId', { patientId: query.patientId });
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
          status: In(ACTIVE_APPOINTMENT_STATUSES),
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
          status: In(ACTIVE_APPOINTMENT_STATUSES),
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
