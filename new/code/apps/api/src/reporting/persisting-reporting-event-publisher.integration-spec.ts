import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AppModule } from '../app/app.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { dataSource as globalDataSource } from '../database/data-source.js';
import { TenantContextService } from '@hospital/tenant-context';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { DepositsService } from '../billing/deposits.service.js';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';

describe('PersistingReportingEventPublisher (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let accountsService: AccountsService;

  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let admissionsService: AdmissionsService;
  let ordersService: OrdersService;
  let invoicesService: InvoicesService;
  let depositsService: DepositsService;

  const TEST_TENANT_ID_1 = `test_reporting_${Date.now()}`;
  const TEST_TENANT_ID_2 = `test_reporting_iso_${Date.now()}`;
  const DOCTOR_ID = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = globalDataSource;
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    accountsService = moduleFixture.get(AccountsService);
    tenantConnection = moduleFixture.get(TenantConnectionService);
    tenantContextService = moduleFixture.get(TenantContextService);
    patientsService = moduleFixture.get(PatientsService);
    masterDataService = moduleFixture.get(MasterDataService);
    admissionsService = moduleFixture.get(AdmissionsService);
    ordersService = moduleFixture.get(OrdersService);
    invoicesService = moduleFixture.get(InvoicesService);
    depositsService = moduleFixture.get(DepositsService);

    // Provision tenant schemas directly — no central Tenant row is needed for schema/table setup.
    await accountsService.provisionTenantSchema(dataSource, TEST_TENANT_ID_1);
    await accountsService.provisionTenantSchema(dataSource, TEST_TENANT_ID_2);
  });

  afterAll(async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(
        `DROP SCHEMA IF EXISTS "tenant_${TEST_TENANT_ID_1}" CASCADE`,
      );
      await queryRunner.query(
        `DROP SCHEMA IF EXISTS "tenant_${TEST_TENANT_ID_2}" CASCADE`,
      );
    } finally {
      await queryRunner.release();
    }
    await app.close();
  });

  function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextService.run(
      { tenantId, correlationId: 'test-correlation' },
      work,
    );
  }

  async function getEvents(tenantId: string, eventType: string) {
    return inTenant(tenantId, () =>
      tenantConnection.runInTenantSchema((manager) =>
        manager
          .getRepository(ReportingEvent)
          .find({ where: { eventType }, order: { occurredAt: 'ASC' } }),
      ),
    );
  }

  it('does not create a reporting event for unmapped entities (Patient)', async () => {
    await inTenant(TEST_TENANT_ID_1, async () => {
      const beforeCount = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(ReportingEvent).count(),
      );

      await patientsService.create({
        firstName: 'Unmapped',
        lastName: 'Entity',
        gender: 'Female',
        phoneNumber: '9999999998',
      });

      const afterCount = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(ReportingEvent).count(),
      );
      expect(afterCount).toBe(beforeCount);
    });
  });

  it('captures all 6 mapped business events successfully', async () => {
    await inTenant(TEST_TENANT_ID_1, async () => {
      const patient = await patientsService.create({
        firstName: 'Report',
        lastName: 'Patient',
        gender: 'Male',
        phoneNumber: '9999999999',
      });

      // Setup a ward with two beds so admission + transfer have somewhere to go
      const ward = await masterDataService.createWard({
        wardName: 'RW1',
        wardCode: 'RW1',
        wardType: 'General',
      });
      const bed1 = await masterDataService.createBed({
        wardId: ward.id,
        bedNumber: 'R-B1',
      });
      const bed2 = await masterDataService.createBed({
        wardId: ward.id,
        bedNumber: 'R-B2',
      });

      // 1. PatientAdmitted
      const admission = await admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'Direct',
        admittingDoctorId: DOCTOR_ID,
        bedId: bed1.id,
      });

      // 2. BedTransferred (admit() also emits an initial BedTransferred; transfer() emits a second)
      await admissionsService.transfer(admission.id, {
        toBedId: bed2.id,
        transferredBy: DOCTOR_ID,
        reason: 'Upgrade',
      });

      // 3. OrderPlaced
      const order = await ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [
          { itemType: 'Lab', itemDescription: 'CBC', priority: 'Routine' },
        ],
      });

      // 4. InvoiceCreated
      const invoice = await invoicesService.create({
        patientId: patient.id,
        createdBy: DOCTOR_ID,
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 500 }],
      });

      // 5. PaymentRecorded
      const payment = await invoicesService.recordPayment(invoice.id, {
        amount: 500,
        paymentMode: 'Cash',
        receivedBy: DOCTOR_ID,
      });

      // 6. DepositReceived
      const deposit = await depositsService.create({
        patientId: patient.id,
        amount: 1000,
        receivedBy: DOCTOR_ID,
      });

      // Verify PatientAdmitted
      const admittedEvents = await getEvents(
        TEST_TENANT_ID_1,
        'PatientAdmitted',
      );
      expect(admittedEvents).toHaveLength(1);
      expect(admittedEvents[0].entityId).toBe(admission.id);
      expect(admittedEvents[0].payload).toMatchObject({
        admissionId: admission.id,
        patientId: patient.id,
        wardId: ward.id,
        bedId: bed1.id,
      });

      // Verify BedTransferred
      const transferEvents = await getEvents(
        TEST_TENANT_ID_1,
        'BedTransferred',
      );
      expect(transferEvents).toHaveLength(2);

      // Initial admission bed assignment
      expect(transferEvents[0].payload).toMatchObject({
        admissionId: admission.id,
        fromBedId: null,
        toBedId: bed1.id,
      });

      // Transfer
      expect(transferEvents[1].entityId).toBe(
        transferEvents[1].payload.bedTransferId,
      );
      expect(transferEvents[1].payload).toMatchObject({
        admissionId: admission.id,
        fromBedId: bed1.id,
        toBedId: bed2.id,
      });

      // Verify OrderPlaced.
      // Only Order-native columns are captured: afterInsert fires on the `orders` row before
      // OrdersService saves its OrderItem rows, so item data is deliberately not in the payload.
      const orderEvents = await getEvents(TEST_TENANT_ID_1, 'OrderPlaced');
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].entityId).toBe(order.id);
      expect(orderEvents[0].payload).toMatchObject({
        orderId: order.id,
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        sourceAppointmentId: null,
        sourceAdmissionId: null,
      });
      expect(orderEvents[0].payload).not.toHaveProperty('itemCount');
      expect(orderEvents[0].payload).not.toHaveProperty('itemTypes');

      // Verify InvoiceCreated
      const invoiceEvents = await getEvents(TEST_TENANT_ID_1, 'InvoiceCreated');
      expect(invoiceEvents).toHaveLength(1);
      expect(invoiceEvents[0].entityId).toBe(invoice.id);
      expect(invoiceEvents[0].payload).toMatchObject({
        invoiceId: invoice.id,
        patientId: patient.id,
      });
      expect(invoiceEvents[0].payload.totalAmount).toBeDefined();

      // Verify PaymentRecorded
      const paymentEvents = await getEvents(
        TEST_TENANT_ID_1,
        'PaymentRecorded',
      );
      expect(paymentEvents).toHaveLength(1);
      expect(paymentEvents[0].entityId).toBe(payment.id);
      expect(paymentEvents[0].payload).toMatchObject({
        paymentId: payment.id,
        invoiceId: invoice.id,
        paymentMode: 'Cash',
      });

      // Verify DepositReceived
      const depositEvents = await getEvents(
        TEST_TENANT_ID_1,
        'DepositReceived',
      );
      expect(depositEvents).toHaveLength(1);
      expect(depositEvents[0].entityId).toBe(deposit.id);
      expect(depositEvents[0].payload).toMatchObject({
        depositId: deposit.id,
        patientId: patient.id,
      });
    });
  });

  it('does not feed reporting events back into the audit trail', async () => {
    // ReportingEvent is @AuditExcludeEntity() — otherwise every archived event would also
    // be written to audit_records, doubling writes and duplicating the payload.
    const auditRows = await inTenant(TEST_TENANT_ID_1, () =>
      tenantConnection.runInTenantSchema((m) =>
        m
          .getRepository(AuditRecord)
          .count({ where: { tableName: 'reporting_events' } }),
      ),
    );
    expect(auditRows).toBe(0);
  });

  it('enforces tenant isolation', async () => {
    await inTenant(TEST_TENANT_ID_2, async () => {
      const events = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(ReportingEvent).count(),
      );
      expect(events).toBe(0); // Should be 0 because all previous events were in TEST_TENANT_ID_1
    });
  });

  // Global Constraint: "Failed reporting-archive write must never roll back or block the
  // real business transaction." The first test drives the realistic path — the reporting_events
  // insert itself blows up inside the publisher. The second removes the publisher from the
  // equation entirely, pinning the subscriber's own guard.
  describe('when the reporting-archive write fails', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('still commits the business insert when the reporting_events save throws', async () => {
      const realSave = Repository.prototype.save;
      jest.spyOn(Repository.prototype, 'save').mockImplementation(function (
        this: Repository<ObjectLiteral>,
        ...args: unknown[]
      ) {
        if (this.target === ReportingEvent) {
          return Promise.reject(
            new Error('simulated reporting_events write failure'),
          );
        }
        return (realSave as (...a: unknown[]) => Promise<unknown>).apply(
          this,
          args,
        );
      } as typeof Repository.prototype.save);

      const { order, patientId } = await inTenant(
        TEST_TENANT_ID_1,
        async () => {
          const patient = await patientsService.create({
            firstName: 'Archive',
            lastName: 'Failure',
            gender: 'Male',
            phoneNumber: '9999999997',
          });
          const created = await ordersService.create({
            patientId: patient.id,
            orderedBy: DOCTOR_ID,
            items: [
              { itemType: 'Lab', itemDescription: 'LFT', priority: 'Routine' },
            ],
          });
          return { order: created, patientId: patient.id };
        },
      );

      jest.restoreAllMocks();

      // The business transaction committed: the order and its items are readable.
      const persisted = await inTenant(TEST_TENANT_ID_1, () =>
        ordersService.findOne(order.id),
      );
      expect(persisted.id).toBe(order.id);
      expect(persisted.patientId).toBe(patientId);
      expect(persisted.items).toHaveLength(1);

      // ...and no reporting event was archived for it.
      const orderEvents = await getEvents(TEST_TENANT_ID_1, 'OrderPlaced');
      expect(orderEvents.map((e) => e.entityId)).not.toContain(order.id);
    });

    it('still commits the business insert when the publisher itself rejects', async () => {
      const publisher = app.get(PersistingReportingEventPublisher);
      jest
        .spyOn(publisher, 'publish')
        .mockRejectedValue(new Error('simulated reporting publisher failure'));

      const order = await inTenant(TEST_TENANT_ID_1, async () => {
        const patient = await patientsService.create({
          firstName: 'Publisher',
          lastName: 'Failure',
          gender: 'Female',
          phoneNumber: '9999999996',
        });
        return ordersService.create({
          patientId: patient.id,
          orderedBy: DOCTOR_ID,
          items: [
            {
              itemType: 'Radiology',
              itemDescription: 'X-Ray',
              priority: 'Routine',
            },
          ],
        });
      });

      jest.restoreAllMocks();

      const persisted = await inTenant(TEST_TENANT_ID_1, () =>
        ordersService.findOne(order.id),
      );
      expect(persisted.id).toBe(order.id);

      const orderEvents = await getEvents(TEST_TENANT_ID_1, 'OrderPlaced');
      expect(orderEvents.map((e) => e.entityId)).not.toContain(order.id);
    });
  });
});
