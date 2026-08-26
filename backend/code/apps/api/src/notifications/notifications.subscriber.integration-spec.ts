import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AppModule } from '../app/app.module.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { Admission } from '../admissions/entities/admission.entity.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { NotificationsService } from './notifications.service.js';
import { Notification } from './entities/notification.entity.js';
import { Account } from '../accounts/entities/account.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('NotificationsSubscriber (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;

  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let admissionsService: AdmissionsService;
  let appointmentsService: AppointmentsService;
  let notificationsService: NotificationsService;

  let DOCTOR_ID: string;

  beforeAll(async () => {
    // Boots the real AppModule DI graph rather than instantiating NotificationsSubscriber by hand:
    // subscribers self-register onto the single shared DataSource in their constructor
    // (notifications.subscriber.ts), so the only way to exercise the real wiring is through the
    // same DataSource domain services use — matches the pattern in
    // reporting/persisting-reporting-event-publisher.integration-spec.ts.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ctx = await setupTenantTestContext({ namePrefix: 'notif_sub' });

    tenantConnection = moduleFixture.get(TenantConnectionService);
    tenantContextService = moduleFixture.get(TenantContextService);
    patientsService = moduleFixture.get(PatientsService);
    masterDataService = moduleFixture.get(MasterDataService);
    admissionsService = moduleFixture.get(AdmissionsService);
    appointmentsService = moduleFixture.get(AppointmentsService);
    notificationsService = moduleFixture.get(NotificationsService);

    // Notifications only ever reach a real Account row (NotificationsService.create() drops
    // anything else) — DOCTOR_ID must be a real account for the "notification arrives" specs
    // below to exercise anything beyond the drop path.
    DOCTOR_ID = await tenantContextService.run({ tenantId: ctx.tenantId, correlationId: 'test' }, () =>
      tenantConnection
        .runInTenantSchema((manager: EntityManager) =>
          manager.getRepository(Account).save(
            manager.getRepository(Account).create({
              accountType: 'staff',
              displayName: 'Notif Test Doctor',
              isActive: true,
            }),
          ),
        )
        .then((account) => account.id),
    );
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  // Do NOT replace with ctx.inTenant(): every service here is resolved from the AppModule DI
  // graph, which holds one shared TenantContextService instance (TenantContextModule is
  // @Global()). ctx.inTenant() runs on ctx's own separate, standalone TenantContextService — a
  // different AsyncLocalStorage entirely.
  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContextService.run({ tenantId: ctx.tenantId, correlationId: 'test' }, work);
  }

  function notificationsFor(recipientAccountId: string) {
    return tenantConnection.runInTenantSchema((manager: EntityManager) =>
      manager.getRepository(Notification).find({ where: { recipientAccountId } }),
    );
  }

  it('notifies the admitting doctor when a patient is admitted', async () => {
    await inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Notif',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber: '4440000001',
      });
      const ward = await masterDataService.createWard({ wardCode: 'NOTIF1', wardName: 'NOTIF1' });
      const bed = await masterDataService.createBed({ wardId: ward.id, bedNumber: '1' });

      const admission = await admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'Direct',
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      });

      const notifications = await notificationsFor(DOCTOR_ID);
      const match = notifications.find((n: Notification) => n.message.includes(bed.id));
      expect(match).toBeDefined();
      expect(match?.title).toBe('New Patient Admission');
      expect(match?.message).toContain(admission.wardId);
    });
  });

  it('notifies the assigned doctor when an appointment is created with a doctorId', async () => {
    await inTenant(async () => {
      const appointment = await appointmentsService.create({
        firstName: 'Appt',
        lastName: 'Patient',
        contactNumber: '4440000002',
        appointmentDate: '2026-09-01',
        appointmentTime: '10:00',
        doctorId: DOCTOR_ID,
        appointmentType: 'Consultation',
      });

      const notifications = await notificationsFor(DOCTOR_ID);
      const match = notifications.find(
        (n: Notification) => n.message.includes(appointment.id) || n.message.includes('Appt Patient'),
      );
      expect(match).toBeDefined();
      expect(match?.title).toBe('New Appointment Scheduled');
    });
  });

  it('does not create a notification for an appointment with no doctorId', async () => {
    await inTenant(async () => {
      const beforeCount = await tenantConnection.runInTenantSchema((m: EntityManager) =>
        m.getRepository(Notification).count(),
      );

      await appointmentsService.create({
        firstName: 'Walkin',
        lastName: 'Patient',
        contactNumber: '4440000003',
        appointmentDate: '2026-09-01',
        appointmentTime: '11:00',
        appointmentType: 'Consultation',
      });

      const afterCount = await tenantConnection.runInTenantSchema((m: EntityManager) =>
        m.getRepository(Notification).count(),
      );
      expect(afterCount).toBe(beforeCount);
    });
  });

  it('does not create a reachable notification when admittingDoctorId has no matching account', async () => {
    await inTenant(async () => {
      const bogusDoctorId = '00000000-0000-0000-0000-0000000000bb';

      const patient = await patientsService.create({
        firstName: 'Orphan',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber: '4440000005',
      });
      const ward = await masterDataService.createWard({ wardCode: 'NOTIF3', wardName: 'NOTIF3' });
      const bed = await masterDataService.createBed({ wardId: ward.id, bedNumber: '1' });

      const admission = await admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'Direct',
        admittingDoctorId: bogusDoctorId,
        bedId: bed.id,
      });

      expect(admission.id).toBeDefined();
      const notifications = await notificationsFor(bogusDoctorId);
      expect(notifications).toHaveLength(0);
    });
  });

  it('does not let a notification failure block the admission write', async () => {
    await inTenant(async () => {
      const createSpy = jest
        .spyOn(notificationsService, 'create')
        .mockRejectedValueOnce(new Error('simulated notification failure'));

      const patient = await patientsService.create({
        firstName: 'Resilient',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber: '4440000004',
      });
      const ward = await masterDataService.createWard({ wardCode: 'NOTIF2', wardName: 'NOTIF2' });
      const bed = await masterDataService.createBed({ wardId: ward.id, bedNumber: '1' });

      // Should not throw even though NotificationsService.create() rejects.
      const admission = await admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'Direct',
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      });

      expect(admission.id).toBeDefined();
      const stillPersisted = await tenantConnection.runInTenantSchema((m: EntityManager) =>
        m.getRepository(Admission).findOne({ where: { id: admission.id } }),
      );
      expect(stillPersisted).not.toBeNull();

      createSpy.mockRestore();
    });
  });
});
