import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AppointmentsService, CreateAppointmentInput, UpdateAppointmentInput } from './appointments.service.js';
import { Appointment } from './entities/appointment.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AppointmentsService (integration)', () => {
  let ctx: TenantTestContext;
  let appointmentsService: AppointmentsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'appointments_svc' });
    appointmentsService = new AppointmentsService(ctx.tenantConnection);
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
});
