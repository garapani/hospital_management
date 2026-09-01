import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { AppointmentsService, CreateAppointmentInput, UpdateAppointmentInput } from './appointments.service.js';
import { Appointment } from './entities/appointment.entity.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { Department } from '../master-data/entities/department.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AppointmentsService (integration)', () => {
  let ctx: TenantTestContext;
  let appointmentsService: AppointmentsService;
  let masterDataService: MasterDataService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'appointments_svc' });
    appointmentsService = new AppointmentsService(ctx.tenantConnection);
    masterDataService = new MasterDataService(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  afterEach(async () => {
    // Clean up appointments table after each test. Uses DELETE rather than
    // TypeORM's clear()/TRUNCATE, which fails once other tenant tables (e.g.
    // vitals) hold a foreign key onto appointments.
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        await manager.createQueryBuilder().delete().from(Appointment).execute();
      })
    );
  });

  it('creates an appointment', async () => {
    const input: CreateAppointmentInput = {
      firstName: 'John',
      lastName: 'Doe',
      contactNumber: '1234567890',
      appointmentDate: '2026-08-01',
      appointmentTime: '10:00',
      appointmentType: 'Consultation',
    };

    const appointment = await ctx.inTenant(() => appointmentsService.create(input));
    expect(appointment.id).toBeDefined();
    expect(appointment.firstName).toBe('John');
    expect(appointment.status).toBe('Scheduled');
  });

  it('retrieves an appointment by id', async () => {
    const input: CreateAppointmentInput = {
      firstName: 'Jane',
      lastName: 'Smith',
      contactNumber: '9876543210',
      appointmentDate: '2026-08-02',
      appointmentTime: '11:00',
      appointmentType: 'Follow-up',
    };

    const created = await ctx.inTenant(() => appointmentsService.create(input));
    const retrieved = await ctx.inTenant(() => appointmentsService.getById(created.id));
    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(created.id);
  });

  it('throws NotFoundException for non-existent appointment', async () => {
    const fakeId = '11111111-1111-1111-1111-111111111111';
    await expect(ctx.inTenant(() => appointmentsService.getById(fakeId))).rejects.toThrow(NotFoundException);
  });

  it('updates an appointment', async () => {
    const input: CreateAppointmentInput = {
      firstName: 'Bob',
      lastName: 'Jones',
      contactNumber: '5551234567',
      appointmentDate: '2026-08-03',
      appointmentTime: '09:00',
      appointmentType: 'Consultation',
    };

    const created = await ctx.inTenant(() => appointmentsService.create(input));

    const updateInput: UpdateAppointmentInput = {
      appointmentDate: '2026-08-04',
      appointmentTime: '09:30',
    };

    const updated = await ctx.inTenant(() => appointmentsService.update(created.id, updateInput));
    expect(updated.appointmentDate).toBe('2026-08-04');
    expect(updated.appointmentTime).toContain('09:30');
  });

  it('cancels an appointment with remarks', async () => {
    const input: CreateAppointmentInput = {
      firstName: 'Alice',
      lastName: 'Brown',
      contactNumber: '5559876543',
      appointmentDate: '2026-08-05',
      appointmentTime: '14:00',
      appointmentType: 'Consultation',
    };

    const created = await ctx.inTenant(() => appointmentsService.create(input));

    const cancelled = await ctx.inTenant(() => appointmentsService.cancel(created.id, 'Patient requested cancellation'));
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.cancelledRemarks).toBe('Patient requested cancellation');
  });

  it('throws error when cancelling without remarks', async () => {
    const input: CreateAppointmentInput = {
      firstName: 'Charlie',
      lastName: 'Davis',
      contactNumber: '5551112222',
      appointmentDate: '2026-08-06',
      appointmentTime: '15:00',
      appointmentType: 'Consultation',
    };

    const created = await ctx.inTenant(() => appointmentsService.create(input));

    await expect(ctx.inTenant(() => appointmentsService.cancel(created.id, ''))).rejects.toThrow(BadRequestException);
  });

  it('rejects updating a cancelled appointment', async () => {
    const created = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Cancelled', lastName: 'One', contactNumber: '5550000001',
      appointmentDate: '2026-08-07', appointmentTime: '09:00', appointmentType: 'Consultation',
    }));
    await ctx.inTenant(() => appointmentsService.cancel(created.id, 'No longer needed'));

    await expect(
      ctx.inTenant(() => appointmentsService.update(created.id, { reason: 'trying to revive it' })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects creating an appointment for a nonexistent patientId', async () => {
    await expect(
      ctx.inTenant(() => appointmentsService.create({
        patientId: '11111111-1111-1111-1111-111111111111',
        firstName: 'Ghost', lastName: 'Patient', contactNumber: '5550000015',
        appointmentDate: '2026-08-23', appointmentTime: '09:00', appointmentType: 'Consultation',
      })),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects updating an appointment to a nonexistent patientId', async () => {
    const created = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Real', lastName: 'Patient', contactNumber: '5550000016',
      appointmentDate: '2026-08-24', appointmentTime: '09:00', appointmentType: 'Consultation',
    }));

    await expect(
      ctx.inTenant(() =>
        appointmentsService.update(created.id, { patientId: '11111111-1111-1111-1111-111111111111' }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects creating an appointment in a slot the doctor already has scheduled', async () => {
    const doctorId = '00000000-0000-4000-8000-0000000000d1';
    await ctx.inTenant(() => appointmentsService.create({
      firstName: 'First', lastName: 'Booking', contactNumber: '5550000010',
      appointmentDate: '2026-08-20', appointmentTime: '09:00', appointmentType: 'Consultation', doctorId,
    }));

    await expect(
      ctx.inTenant(() => appointmentsService.create({
        firstName: 'Second', lastName: 'Booking', contactNumber: '5550000011',
        appointmentDate: '2026-08-20', appointmentTime: '09:00', appointmentType: 'Consultation', doctorId,
      })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects creating an appointment once a department has reached its daily capacity', async () => {
    const department = await ctx.inTenant(() => masterDataService.createDepartment({
      departmentCode: `APPT-CREATE-CAP-${Date.now()}`,
      departmentName: 'Create Capacity Test Dept',
      isAppointmentApplicable: true,
    }));
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        await manager.getRepository(Department).update(department.id, { maxDailyAppointments: 1 });
      }),
    );

    await ctx.inTenant(() => appointmentsService.create({
      firstName: 'First', lastName: 'InDept', contactNumber: '5550000012',
      appointmentDate: '2026-08-21', appointmentTime: '09:00', appointmentType: 'Consultation', departmentId: department.id,
    }));

    await expect(
      ctx.inTenant(() => appointmentsService.create({
        firstName: 'Second', lastName: 'InDept', contactNumber: '5550000013',
        appointmentDate: '2026-08-21', appointmentTime: '10:00', appointmentType: 'Consultation', departmentId: department.id,
      })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects cancelling an already-cancelled appointment', async () => {
    const created = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Twice', lastName: 'Cancelled', contactNumber: '5550000014',
      appointmentDate: '2026-08-22', appointmentTime: '09:00', appointmentType: 'Consultation',
    }));
    await ctx.inTenant(() => appointmentsService.cancel(created.id, 'First cancellation'));

    await expect(
      ctx.inTenant(() => appointmentsService.cancel(created.id, 'Second cancellation')),
    ).rejects.toThrow(ConflictException);
  });

  it('checks in a scheduled appointment', async () => {
    const created = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Waiting', lastName: 'Room', contactNumber: '5550000020',
      appointmentDate: '2026-08-25', appointmentTime: '09:00', appointmentType: 'Consultation',
    }));

    const checkedIn = await ctx.inTenant(() => appointmentsService.checkIn(created.id));
    expect(checkedIn.status).toBe('CheckedIn');
  });

  it('rejects checking in an appointment that is not Scheduled', async () => {
    const created = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Already', lastName: 'CheckedIn', contactNumber: '5550000021',
      appointmentDate: '2026-08-25', appointmentTime: '10:00', appointmentType: 'Consultation',
    }));
    await ctx.inTenant(() => appointmentsService.checkIn(created.id));

    await expect(ctx.inTenant(() => appointmentsService.checkIn(created.id))).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException checking in a non-existent appointment', async () => {
    const fakeId = '22222222-2222-2222-2222-222222222222';
    await expect(ctx.inTenant(() => appointmentsService.checkIn(fakeId))).rejects.toThrow(NotFoundException);
  });

  it('still blocks double-booking a doctor slot once the original appointment is checked in', async () => {
    const doctorId = '00000000-0000-4000-8000-0000000000d4';
    const created = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'First', lastName: 'Arrived', contactNumber: '5550000022',
      appointmentDate: '2026-08-26', appointmentTime: '09:00', appointmentType: 'Consultation', doctorId,
    }));
    await ctx.inTenant(() => appointmentsService.checkIn(created.id));

    await expect(
      ctx.inTenant(() => appointmentsService.create({
        firstName: 'Second', lastName: 'Attempt', contactNumber: '5550000023',
        appointmentDate: '2026-08-26', appointmentTime: '09:00', appointmentType: 'Consultation', doctorId,
      })),
    ).rejects.toThrow(ConflictException);
  });

  it('still counts toward department daily capacity once checked in', async () => {
    const department = await ctx.inTenant(() => masterDataService.createDepartment({
      departmentCode: `APPT-CHECKEDIN-CAP-${Date.now()}`,
      departmentName: 'Checked-In Capacity Test Dept',
      isAppointmentApplicable: true,
    }));
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        await manager.getRepository(Department).update(department.id, { maxDailyAppointments: 1 });
      }),
    );

    const created = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Filled', lastName: 'AndArrived', contactNumber: '5550000024',
      appointmentDate: '2026-08-27', appointmentTime: '09:00', appointmentType: 'Consultation', departmentId: department.id,
    }));
    await ctx.inTenant(() => appointmentsService.checkIn(created.id));

    await expect(
      ctx.inTenant(() => appointmentsService.create({
        firstName: 'Second', lastName: 'InDept', contactNumber: '5550000025',
        appointmentDate: '2026-08-27', appointmentTime: '10:00', appointmentType: 'Consultation', departmentId: department.id,
      })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects rescheduling into a slot the doctor already has scheduled', async () => {
    const doctorId = '00000000-0000-4000-8000-0000000000d2';
    await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Existing', lastName: 'Booking', contactNumber: '5550000002',
      appointmentDate: '2026-08-08', appointmentTime: '09:00', appointmentType: 'Consultation', doctorId,
    }));
    const toMove = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Moving', lastName: 'Around', contactNumber: '5550000003',
      appointmentDate: '2026-08-08', appointmentTime: '10:00', appointmentType: 'Consultation', doctorId,
    }));

    await expect(
      ctx.inTenant(() => appointmentsService.update(toMove.id, { appointmentTime: '09:00' })),
    ).rejects.toThrow(ConflictException);
  });

  it('allows re-saving an appointment at its own existing doctor/date/time (no self-conflict)', async () => {
    const doctorId = '00000000-0000-4000-8000-0000000000d3';
    const created = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Steady', lastName: 'Slot', contactNumber: '5550000004',
      appointmentDate: '2026-08-09', appointmentTime: '11:00', appointmentType: 'Consultation', doctorId,
    }));

    const updated = await ctx.inTenant(() =>
      appointmentsService.update(created.id, { appointmentDate: '2026-08-09', appointmentTime: '11:00', doctorId, reason: 'confirmed' }),
    );
    expect(updated.reason).toBe('confirmed');
  });

  it('rejects rescheduling into a department that has reached its daily capacity', async () => {
    const department = await ctx.inTenant(() => masterDataService.createDepartment({
      departmentCode: `APPT-CAP-${Date.now()}`,
      departmentName: 'Capacity Test Dept',
      isAppointmentApplicable: true,
    }));
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        await manager.getRepository(Department).update(department.id, { maxDailyAppointments: 1 });
      }),
    );

    await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Filled', lastName: 'Slot', contactNumber: '5550000005',
      appointmentDate: '2026-08-12', appointmentTime: '09:00', appointmentType: 'Consultation', departmentId: department.id,
    }));
    const toMove = await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Elsewhere', lastName: 'For', contactNumber: '5550000006',
      appointmentDate: '2026-08-13', appointmentTime: '09:00', appointmentType: 'Consultation',
    }));

    await expect(
      ctx.inTenant(() =>
        appointmentsService.update(toMove.id, { appointmentDate: '2026-08-12', departmentId: department.id }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('lists appointments with filters', async () => {
    await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Patient', lastName: 'One', contactNumber: '1', appointmentDate: '2026-08-10', appointmentTime: '09:00', appointmentType: 'A',
    }));

    await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Patient', lastName: 'Two', contactNumber: '2', appointmentDate: '2026-08-11', appointmentTime: '10:00', appointmentType: 'B',
    }));

    const listDate = await ctx.inTenant(() => appointmentsService.list({ date: '2026-08-10' }));
    expect(listDate.meta.total).toBe(1);
    expect(listDate.data[0].firstName).toBe('Patient');
    expect(listDate.data[0].lastName).toBe('One');

    const listAll = await ctx.inTenant(() => appointmentsService.list({}));
    expect(listAll.meta.total).toBe(2);
  });

  it('lists appointments filtered by patientId', async () => {
    const patient = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(Patient).save(
          manager.getRepository(Patient).create({
            patientNo: `APPT-SVC-${Date.now()}`,
            firstName: 'Owned',
            lastName: 'Patient',
            gender: 'Female',
          }),
        ),
      ),
    );

    await ctx.inTenant(() => appointmentsService.create({
      patientId: patient.id, firstName: 'Owned', lastName: 'Patient', contactNumber: '1', appointmentDate: '2026-08-10', appointmentTime: '09:00', appointmentType: 'A',
    }));
    await ctx.inTenant(() => appointmentsService.create({
      firstName: 'Other', lastName: 'Patient', contactNumber: '2', appointmentDate: '2026-08-11', appointmentTime: '10:00', appointmentType: 'B',
    }));

    const listForPatient = await ctx.inTenant(() => appointmentsService.list({ patientId: patient.id }));
    expect(listForPatient.meta.total).toBe(1);
    expect(listForPatient.data[0].patientId).toBe(patient.id);
  });
});
