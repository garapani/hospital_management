import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AppointmentsService, CreateAppointmentInput, UpdateAppointmentInput } from './appointments.service.js';
import { Appointment } from './entities/appointment.entity.js';

describe('AppointmentsService (integration)', () => {
  let dataSource: DataSource;
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let appointmentsService: AppointmentsService;
  let accountsService: AccountsService;
  const TEST_TENANT_ID = 'test_appointments_svc';
  const ACTOR_ID = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    accountsService = new AccountsService(tenantConnection, dataSource);
    appointmentsService = new AppointmentsService(tenantConnection);

    // Provision the schema and tables for our test tenant
    await accountsService.provisionTenantSchema(dataSource, TEST_TENANT_ID);
  });

  afterAll(async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`DROP SCHEMA IF EXISTS "tenant_${TEST_TENANT_ID}" CASCADE`);
    } finally {
      await queryRunner.release();
      await dataSource.destroy();
    }
  });

  afterEach(async () => {
    // Clean up appointments table after each test. Uses DELETE rather than
    // TypeORM's clear()/TRUNCATE, which fails once other tenant tables (e.g.
    // vitals) hold a foreign key onto appointments.
    await inTenant(() =>
      tenantConnection.runInTenantSchema(async (manager) => {
        await manager.createQueryBuilder().delete().from(Appointment).execute();
      })
    );
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: TEST_TENANT_ID, correlationId: 'test', accountId: ACTOR_ID }, work);
  }

  it('creates an appointment', async () => {
    const input: CreateAppointmentInput = {
      firstName: 'John',
      lastName: 'Doe',
      contactNumber: '1234567890',
      appointmentDate: '2026-08-01',
      appointmentTime: '10:00',
      appointmentType: 'Consultation',
    };

    const appointment = await inTenant(() => appointmentsService.create(input));
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

    const created = await inTenant(() => appointmentsService.create(input));
    const retrieved = await inTenant(() => appointmentsService.getById(created.id));
    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(created.id);
  });

  it('throws NotFoundException for non-existent appointment', async () => {
    const fakeId = '11111111-1111-1111-1111-111111111111';
    await expect(inTenant(() => appointmentsService.getById(fakeId))).rejects.toThrow(NotFoundException);
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

    const created = await inTenant(() => appointmentsService.create(input));
    
    const updateInput: UpdateAppointmentInput = {
      appointmentDate: '2026-08-04',
      appointmentTime: '09:30',
    };
    
    const updated = await inTenant(() => appointmentsService.update(created.id, updateInput));
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

    const created = await inTenant(() => appointmentsService.create(input));
    
    const cancelled = await inTenant(() => appointmentsService.cancel(created.id, 'Patient requested cancellation'));
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

    const created = await inTenant(() => appointmentsService.create(input));
    
    await expect(inTenant(() => appointmentsService.cancel(created.id, ''))).rejects.toThrow(BadRequestException);
  });

  it('lists appointments with filters', async () => {
    await inTenant(() => appointmentsService.create({
      firstName: 'Patient', lastName: 'One', contactNumber: '1', appointmentDate: '2026-08-10', appointmentTime: '09:00', appointmentType: 'A',
    }));
    
    await inTenant(() => appointmentsService.create({
      firstName: 'Patient', lastName: 'Two', contactNumber: '2', appointmentDate: '2026-08-11', appointmentTime: '10:00', appointmentType: 'B',
    }));

    const listDate = await inTenant(() => appointmentsService.list({ date: '2026-08-10' }));
    expect(listDate.length).toBe(1);
    expect(listDate[0].firstName).toBe('Patient');
    expect(listDate[0].lastName).toBe('One');
    
    const listAll = await inTenant(() => appointmentsService.list({}));
    expect(listAll.length).toBe(2);
  });
});
